import { runRecurringRentBilling } from './rentmate-recurring-rent-runner.js';

const TIME_ZONE = 'Africa/Johannesburg';
const INTERVAL_MS = 60_000;

function southAfricanClock(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date);

    const get = name =>
        parts.find(part => part.type === name)?.value;

    return {
        year: Number(get('year')),
        month: Number(get('month')),
        day: Number(get('day')),
        hour: Number(get('hour')),
        minute: Number(get('minute'))
    };
}

export function isRecurringRentExecutionWindow(date = new Date()) {
    const clock = southAfricanClock(date);

    const lastDay = new Date(
        Date.UTC(clock.year, clock.month, 0)
    ).getUTCDate();

    return (
        clock.day === lastDay &&
        (clock.hour > 0 ||
            (clock.hour === 0 && clock.minute >= 5))
    );
}

export function startRecurringRentService(pool) {
    if (process.env.RENTMATE_RECURRING_RENT_ENABLED !== 'true') {
        console.log(
            '[Recurring Rent] Automatic execution disabled.'
        );
        return null;
    }

    let running = false;

    const tick = async () => {
        if (running || !isRecurringRentExecutionWindow()) {
            return;
        }

        running = true;

        try {
            const result = await runRecurringRentBilling(pool, {
                mode: 'execute',
                allowExecution: true
            });

            console.log(
                '[Recurring Rent] Execution result:',
                JSON.stringify(result)
            );
        } catch (error) {
            console.error(
                '[Recurring Rent] Execution failed:',
                error.message
            );
        } finally {
            running = false;
        }
    };

    console.log(
        '[Recurring Rent] Scheduler enabled for month-end.'
    );

    const timer = setInterval(tick, INTERVAL_MS);
    timer.unref?.();

    void tick();

    return timer;
}
