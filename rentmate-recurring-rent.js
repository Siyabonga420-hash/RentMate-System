'use strict';

/*
 * RentMate recurring rent utilities.
 *
 * These functions calculate billing dates only.
 * They do not create charges or process payments.
 */

function validBillingMonth(month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))) {
        throw new Error('Billing month must use YYYY-MM.');
    }

    return String(month);
}

function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function billingDueDate(billingMonth, dueDay = 31, useMonthEnd = true) {
    const month = validBillingMonth(billingMonth);
    const year = Number(month.slice(0, 4));
    const monthNumber = Number(month.slice(5, 7));

    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
        throw new Error('Due day must be between 1 and 31.');
    }

    const lastDay = daysInMonth(year, monthNumber);
    const day = useMonthEnd ? lastDay : Math.min(dueDay, lastDay);

    return [
        String(year).padStart(4, '0'),
        String(monthNumber).padStart(2, '0'),
        String(day).padStart(2, '0')
    ].join('-');
}

function billingMonthFromDate(date = new Date()) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        throw new Error('A valid date is required.');
    }

    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Johannesburg',
        year: 'numeric',
        month: '2-digit'
    }).formatToParts(date);

    const year = parts.find(part => part.type === 'year').value;
    const month = parts.find(part => part.type === 'month').value;

    return `${year}-${month}`;
}

export {
    validBillingMonth,
    daysInMonth,
    billingDueDate,
    billingMonthFromDate
};