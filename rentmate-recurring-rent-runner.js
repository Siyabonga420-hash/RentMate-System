import {
    previewRecurringRentSchedule
} from './rentmate-recurring-rent-scheduler.js';

import {
    generateRecurringRent
} from './rentmate-recurring-rent-engine.js';

/*
 * RentMate controlled recurring billing runner.
 *
 * This module does not start automatically.
 * Preview is the default and never writes.
 *
 * Execution requires BOTH:
 * - mode: 'execute'
 * - allowExecution: true
 *
 * The caller must independently enforce authorisation.
 */

export async function runRecurringRentBilling(pool, options = {}) {
    const mode = options.mode ?? 'preview';

    if (!['preview', 'execute'].includes(mode)) {
        throw new Error('Invalid recurring billing mode.');
    }

    if (mode === 'execute' && options.allowExecution !== true) {
        throw new Error(
            'Recurring rent execution is not authorised.'
        );
    }

    const preview = await previewRecurringRentSchedule(pool, {
        today: options.today
    });

    if (mode === 'preview') {
        return {
            ...preview,
            mode: 'preview',
            executed: false
        };
    }

    const eligibleManagers = preview.managers.filter(
        manager =>
            manager.eligible &&
            manager.activeTenants > 0
    );

    const results = [];

    for (const manager of eligibleManagers) {
        try {
            const result = await generateRecurringRent(
                pool,
                manager.managerId,
                preview.billingMonth,
                { today: preview.today }
            );

            results.push({
                managerId: manager.managerId,
                success: true,
                result
            });
        } catch (error) {
            results.push({
                managerId: manager.managerId,
                success: false,
                error: error.message
            });
        }
    }

    return {
        today: preview.today,
        billingMonth: preview.billingMonth,
        mode: 'execute',
        executed: true,
        eligibleManagers: eligibleManagers.length,
        results
    };
}