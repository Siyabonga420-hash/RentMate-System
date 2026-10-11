import {
    billingDueDate,
    billingMonthFromDate
} from './rentmate-recurring-rent.js';

/*
 * RentMate recurring rent scheduler.
 *
 * SAFETY:
 * - Preview mode only.
 * - Does not create rent charges.
 * - Does not modify the database.
 * - Does not process payments.
 * - Does not run automatically.
 */

export async function previewRecurringRentSchedule(pool, options = {}) {
    const today = options.today ||
        new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Africa/Johannesburg',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(new Date());

    if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
        throw new Error('Invalid scheduler date format.');
    }

    const month = billingMonthFromDate(
        new Date(`${today}T12:00:00+02:00`)
    );

    const result = await pool.query(
        `SELECT
            s.manager_id,
            s.amount_due,
            s.due_day,
            s.use_month_end,
            s.enabled,
            COUNT(t.id)::integer AS active_tenants
         FROM recurring_rent_settings s
         LEFT JOIN tenants t
           ON t.manager_id = s.manager_id
          AND lower(t.status) = 'active'
         WHERE s.enabled = true
         GROUP BY
            s.manager_id,
            s.amount_due,
            s.due_day,
            s.use_month_end,
            s.enabled
         ORDER BY s.manager_id`
    );

    const managers = result.rows.map(row => {
        const dueDate = billingDueDate(
            month,
            Number(row.due_day),
            row.use_month_end
        );

        const eligible = today >= dueDate;

        return {
            managerId: row.manager_id,
            billingMonth: month,
            dueDate,
            amountDue: Number(row.amount_due),
            activeTenants: Number(row.active_tenants),
            eligible,
            estimatedTotal:
                Number(row.amount_due) *
                Number(row.active_tenants)
        };
    });

    return {
        today,
        billingMonth: month,
        managers,
        eligibleManagers: managers.filter(
            manager => manager.eligible
        ).length,
        previewOnly: true
    };
}