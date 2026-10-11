import {
    billingDueDate,
    billingMonthFromDate,
    validBillingMonth
} from './rentmate-recurring-rent.js';

/*
 * RentMate recurring rent database engine.
 *
 * This module does not run automatically.
 * It must be called explicitly by the backend.
 *
 * Required database migration:
 * sql/003_recurring_rent.sql
 */

export async function generateRecurringRent(
    pool,
    managerId,
    billingMonth = billingMonthFromDate(),
    options = {}
) {
    if (!pool || typeof pool.connect !== 'function') {
        throw new Error('A PostgreSQL connection pool is required.');
    }

    if (!managerId) {
        throw new Error('Manager ID is required.');
    }

    const month = validBillingMonth(billingMonth);
    const monthStart = `${month}-01`;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        /*
         * Serialize billing operations for this manager.
         * This prevents simultaneous requests from generating
         * duplicate charges.
         */
        await client.query(
            `SELECT pg_advisory_xact_lock(
                hashtext($1),
                hashtext($2)
            )`,
            [String(managerId), month]
        );

        const settingsResult = await client.query(
            `SELECT *
             FROM recurring_rent_settings
             WHERE manager_id = $1
             FOR UPDATE`,
            [managerId]
        );

        const settings = settingsResult.rows[0];

        if (!settings || !settings.enabled) {
            await client.query('COMMIT');

            return {
                managerId,
                billingMonth: month,
                enabled: false,
                created: 0,
                skipped: 0,
                total: 0
            };
        }

        const dueDate = billingDueDate(
            month,
            Number(settings.due_day),
            settings.use_month_end
        );

        /*
         * Automatic billing is restricted to the current
         * South African billing month.
         *
         * Charges become eligible only when the configured
         * billing date has arrived.
         *
         * Tests may supply a fixed date through options.today.
         */
        const today = options.today ||
            new Intl.DateTimeFormat('sv-SE', {
                timeZone: 'Africa/Johannesburg',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }).format(new Date());

        const currentMonth = today.slice(0, 7);

        if (month !== currentMonth) {
            throw new Error(
                'Recurring rent can only be generated for the current month.'
            );
        }

        if (today < dueDate) {
            throw new Error(
                'Recurring rent billing date has not arrived.'
            );
        }

        const tenantsResult = await client.query(
            `SELECT id
             FROM tenants
             WHERE manager_id = $1
               AND lower(status) = 'active'
             ORDER BY id`,
            [managerId]
        );

        let created = 0;
        let skipped = 0;

        for (const tenant of tenantsResult.rows) {
            /*
             * Do not create a second rent charge if the tenant
             * already has a manual or automatic charge for
             * the same calendar month.
             */
            const existing = await client.query(
                `SELECT id
                 FROM rent
                 WHERE tenant_id = $1
                   AND due_date >= $2::date
                   AND due_date < (
                       $2::date + INTERVAL '1 month'
                   )
                 LIMIT 1`,
                [tenant.id, monthStart]
            );

            if (existing.rows.length > 0) {
                skipped++;
                continue;
            }

            const rentResult = await client.query(
                `INSERT INTO rent(
                    tenant_id,
                    amount_due,
                    due_date,
                    status
                )
                VALUES ($1, $2, $3, 'unpaid')
                ON CONFLICT (tenant_id, due_date)
                DO NOTHING
                RETURNING id`,
                [
                    tenant.id,
                    settings.amount_due,
                    dueDate
                ]
            );

            const rent = rentResult.rows[0];

            if (!rent) {
                skipped++;
                continue;
            }

            const trackingResult = await client.query(
                `INSERT INTO recurring_rent_charges(
                    manager_id,
                    tenant_id,
                    rent_id,
                    billing_month
                )
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (tenant_id, billing_month)
                DO NOTHING
                RETURNING id`,
                [
                    managerId,
                    tenant.id,
                    rent.id,
                    monthStart
                ]
            );

            if (trackingResult.rows.length !== 1) {
                throw new Error(
                    'Recurring rent tracking conflict; transaction rolled back.'
                );
            }

            created++;
        }

        await client.query(
            `INSERT INTO recurring_rent_runs(
                manager_id,
                billing_month
            )
            VALUES ($1, $2)
            ON CONFLICT (manager_id, billing_month)
            DO NOTHING`,
            [managerId, monthStart]
        );

        await client.query('COMMIT');

        return {
            managerId,
            billingMonth: month,
            dueDate,
            enabled: true,
            amountDue: Number(settings.amount_due),
            created,
            skipped,
            total: tenantsResult.rows.length
        };

    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            console.error(
                'Recurring rent rollback failed:',
                rollbackError.message
            );
        }

        throw error;

    } finally {
        client.release();
    }
}