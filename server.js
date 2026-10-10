import 'dotenv/config';

import express from 'express';
import { registerRentMateSchedulingRoutes } from './rentmate-scheduling.js';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// =====================================================
// 1. APPLICATION CONFIGURATION
// =====================================================

const app = express();

const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost')
        ? false
        : { rejectUnauthorized: true }
});

const JWT = process.env.JWT_SECRET;

if (
    !process.env.DATABASE_URL ||
    !JWT ||
    JWT.length < 32
) {
    console.error(
        'Set DATABASE_URL and JWT_SECRET (32+ characters)'
    );

    process.exit(1);
}

// =====================================================
// 2. SECURITY AND MIDDLEWARE
// =====================================================

app.use(
    helmet({
        contentSecurityPolicy: false
    })
);

const origins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);

app.use(
    cors({
        origin: (origin, cb) => {
            cb(
                null,
                !origin || origins.includes(origin)
            );
        }
    })
);

app.use(
    express.json({
        limit: '100kb'
    })
);

const authLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false
});

// =====================================================
// 3. HELPER FUNCTIONS
// =====================================================

const wrap = fn => (req, res, next) =>
    Promise.resolve(
        fn(req, res, next)
    ).catch(next);

const fail = (status, message) =>
    Object.assign(
        new Error(message),
        { status }
    );

const q = (sql, params = []) =>
    db.query(sql, params);

const one = async (sql, params = []) =>
    (await q(sql, params)).rows[0];

const allowed = (obj, keys) =>
    Object.fromEntries(
        keys
            .filter(k => obj[k] !== undefined)
            .map(k => [k, obj[k]])
    );

const positive = n =>
    Number.isFinite(Number(n)) &&
    Number(n) > 0;

const uuid = s =>
    typeof s === 'string' &&
    /^[a-f\d]{8}-([a-f\d]{4}-){3}[a-f\d]{12}$/i.test(s);

// =====================================================
// 4. AUTHENTICATION MIDDLEWARE
// =====================================================

const authenticate = wrap(async (req, res, next) => {

    const token = /^Bearer (.+)$/i.exec(
        req.headers.authorization || ''
    )?.[1];

    if (!token) {
        throw fail(401, 'Please log in');
    }

    try {

        req.auth = jwt.verify(
            token,
            JWT,
            {
                algorithms: ['HS256']
            }
        );

    } catch {

        throw fail(
            401,
            'Session expired; please log in again'
        );
    }

    const u = await one(
        `SELECT id, email, full_name, phone, role
         FROM users
         WHERE id = $1`,
        [req.auth.sub]
    );

    if (!u) {
        throw fail(401, 'Account not found');
    }

    req.user = u;

    next();
});

const roles = (...allowedRoles) =>
    (req, res, next) =>
        allowedRoles.includes(req.user.role)
            ? next()
            : next(fail(403, 'Access denied'));

// =====================================================
// 5. USER AND HOUSEHOLD HELPERS
// =====================================================

const managerId = async req => {

    if (
        req.user.role === 'admin' &&
        uuid(req.query.manager_id)
    ) {
        return req.query.manager_id;
    }

    const m = await one(
        'SELECT id FROM managers WHERE user_id=$1',
        [req.user.id]
    );

    if (!m) {
        throw fail(
            403,
            'Manager account not configured'
        );
    }

    return m.id;
};

const tenant = async req => {

    const t = await one(
        'SELECT * FROM tenants WHERE user_id=$1',
        [req.user.id]
    );

    if (!t) {
        throw fail(
            404,
            'Tenant record not found'
        );
    }

    return t;
};

const managerTenant = async (req, id) => {

    const m = await managerId(req);

    const t = await one(
        `SELECT *
         FROM tenants
         WHERE id=$1 AND manager_id=$2`,
        [id, m]
    );

    if (!t) {
        throw fail(
            404,
            'Tenant not found in your portfolio'
        );
    }

    return t;
};

const householdAccess = async (req, id) => {

    if (req.user.role === 'admin') {
        return;
    }

    const t = await one(
        `SELECT 1
         FROM tenants
         WHERE user_id=$1
         AND household_id=$2`,
        [req.user.id, id]
    );

    if (t) {
        return;
    }

    if (req.user.role === 'manager') {

        const m = await managerId(req);

        const r = await one(
            `SELECT 1
             FROM households h
             JOIN units u ON u.id=h.unit_id
             JOIN properties p ON p.id=u.property_id
             WHERE h.id=$1
             AND p.manager_id=$2`,
            [id, m]
        );

        if (r) {
            return;
        }
    }

    throw fail(
        403,
        'Household access denied'
    );
};

const ownHousehold = async req => {

    const t = await tenant(req);

    if (!t.household_id) {
        throw fail(
            403,
            'Awaiting property assignment'
        );
    }

    return t;
};

// =====================================================
// 6. HEALTH CHECK
// =====================================================

app.get(
    '/health',
    wrap(async (req, res) => {

        await q('SELECT 1');

        res.json({
            ok: true,
            service: 'RentMate Node API'
        });
    })
);

// =====================================================
// 7. REGISTER
// =====================================================

app.post(
    '/auth/register',
    authLimit,
    wrap(async (req, res) => {

        const {
            email,
            password,
            full_name,
            phone = ''
        } = req.body;

        if (
            !email ||
            !/^\S+@\S+\.\S+$/.test(email) ||
            !full_name?.trim() ||
            !password ||
            password.length < 8
        ) {
            throw fail(
                400,
                'Valid email, full name and password (8+ characters) required'
            );
        }

        const hash = await bcrypt.hash(
            password,
            12
        );

        const client = await db.connect();

        try {

            await client.query('BEGIN');

            const u = (
                await client.query(
                    `INSERT INTO users(
                        email,
                        password_hash,
                        full_name,
                        phone,
                        role
                    )
                    VALUES($1,$2,$3,$4,'tenant')
                    RETURNING
                        id,
                        email,
                        full_name,
                        role`,
                    [
                        email.trim().toLowerCase(),
                        hash,
                        full_name.trim(),
                        phone
                    ]
                )
            ).rows[0];

            await client.query(
                `INSERT INTO tenants(user_id)
                 VALUES($1)`,
                [u.id]
            );

            await client.query('COMMIT');

            res.status(201).json({
                user: u,
                message:
                    'Account created. Please log in.'
            });

        } catch (e) {

            await client.query('ROLLBACK');

            throw e;

        } finally {

            client.release();
        }
    })
);

// =====================================================
// 8. LOGIN
// =====================================================

app.post(
    '/auth/login',
    authLimit,
    wrap(async (req, res) => {

        const {
            email,
            password
        } = req.body;

        const u = await one(
            'SELECT * FROM users WHERE email=$1',
            [
                (email || '')
                    .trim()
                    .toLowerCase()
            ]
        );

        if (
            !u ||
            !await bcrypt.compare(
                password || '',
                u.password_hash
            )
        ) {
            throw fail(
                401,
                'Incorrect email or password'
            );
        }

        const token = jwt.sign(
            {
                sub: u.id
            },
            JWT,
            {
                algorithm: 'HS256',
                expiresIn: '12h'
            }
        );

        res.json({
            access_token: token,
            token_type: 'bearer',
            user: {
                id: u.id,
                email: u.email,
                full_name: u.full_name,
                role: u.role
            }
        });
    })
);

// =====================================================
// 9. CURRENT USER
// =====================================================

app.get(
    '/me',
    authenticate,
    (req, res) => {
        res.json(req.user);
    }
);

// =====================================================
// 10. TENANT DASHBOARD
// =====================================================

app.get(
    '/dashboard',
    authenticate,
    wrap(async (req, res) => {

        if (req.user.role !== 'tenant') {

            return res.json({
                assigned: false,
                user_name: req.user.full_name,
                message:
                    'Use the manager or admin portal'
            });
        }

        const t = await tenant(req);

        if (!t.household_id) {

            return res.json({
                assigned: false,
                user_name: req.user.full_name,
                message:
                    'Awaiting property assignment'
            });
        }

        const h = await one(
            `SELECT
                h.id,
                h.name,
                h.type,
                h.pinned_note,
                (
                    SELECT count(*)::int
                    FROM tenants
                    WHERE household_id=h.id
                ) member_count
             FROM households h
             WHERE h.id=$1`,
            [t.household_id]
        );

        const r = await one(
            `SELECT
                r.*,
                coalesce(sum(p.amount),0) paid
             FROM rent r
             LEFT JOIN payments p
                ON p.rent_id=r.id
             WHERE r.tenant_id=$1
             GROUP BY r.id
             ORDER BY r.due_date DESC
             LIMIT 1`,
            [t.id]
        );

        const counts = await one(
            `SELECT
                count(*)::int total,
                count(*) FILTER(
                    WHERE status='completed'
                )::int completed
             FROM chores
             WHERE household_id=$1`,
            [t.household_id]
        );

        const announcements = (
            await q(
                `SELECT title,body
                 FROM announcements
                 WHERE household_id=$1
                 OR (
                     household_id IS NULL
                     AND manager_id=$2
                 )
                 ORDER BY created_at DESC
                 LIMIT 5`,
                [
                    t.household_id,
                    t.manager_id
                ]
            )
        ).rows;

        const due = Number(
            r?.amount_due || 0
        );

        const paid = Number(
            r?.paid || 0
        );

        res.json({

            assigned: true,

            user_name:
                req.user.full_name,

            household: h,

            rent_due: due,

            amount_paid: paid,

            outstanding:
                Math.max(0, due - paid),

            due_date:
                r?.due_date || '',

            payment_status: r
                ? paid >= due
                    ? 'paid'
                    : paid > 0
                        ? 'partial'
                        : 'unpaid'
                : 'none',

            chores_total:
                counts.total,

            chores_completed:
                counts.completed,

            activities:
                announcements.map(a => ({
                    title: a.title,
                    subtitle: a.body
                }))
        });
    })
);

// =====================================================
// 11. UPDATE PROFILE
// =====================================================

app.patch(
    '/me',
    authenticate,
    wrap(async (req, res) => {

        const name = String(
            req.body.full_name || ''
        ).trim();

        const phone = String(
            req.body.phone || ''
        ).trim();

        if (
            name.length < 2 ||
            !/^0[0-9]{9}$/.test(phone)
        ) {
            throw fail(
                400,
                'Name and valid 10-digit SA phone required'
            );
        }

        const updated = await one(
            `UPDATE users
             SET full_name=$1,
                 phone=$2
             WHERE id=$3
             RETURNING
                id,
                email,
                full_name,
                phone,
                role`,
            [
                name,
                phone,
                req.user.id
            ]
        );

        res.json(updated);
    })
);

// =====================================================
// 12. CHANGE PASSWORD
// =====================================================

app.post(
    '/me/password',
    authenticate,
    authLimit,
    wrap(async (req, res) => {

        const u = await one(
            `SELECT password_hash
             FROM users
             WHERE id=$1`,
            [req.user.id]
        );

        const valid = await bcrypt.compare(
            String(
                req.body.current_password || ''
            ),
            u.password_hash
        );

        if (!valid) {
            throw fail(
                400,
                'Current password is incorrect'
            );
        }

        const newPassword = String(
            req.body.new_password || ''
        );

        if (newPassword.length < 10) {
            throw fail(
                400,
                'New password must contain at least 10 characters'
            );
        }

        const hash = await bcrypt.hash(
            newPassword,
            12
        );

        await q(
            `UPDATE users
             SET password_hash=$1
             WHERE id=$2`,
            [
                hash,
                req.user.id
            ]
        );

        res.json({
            ok: true
        });
    })
);

// =====================================================
// 13. HOUSEMATES
// =====================================================

app.get(
    '/my/housemates',
    authenticate,
    wrap(async (req, res) => {

        const t = await ownHousehold(req);

        const result = await q(
            `SELECT t.id AS id, u.full_name
             FROM tenants t
             JOIN users u
                ON u.id=t.user_id
             WHERE t.household_id=$1
             ORDER BY u.full_name`,
            [t.household_id]
        );

        res.json(result.rows);
    })
);

// =====================================================
registerRentMateSchedulingRoutes(app, { authenticate, wrap, ownHousehold, one, q, fail, uuid, managerId, roles, db });

// 14. COMMUNE CHORES
// =====================================================

// Get chores is handled by /my/:type below.

app.post(
    '/my/chores',
    authenticate,
    wrap(async (req, res) => {

        const t = await ownHousehold(req);

        const title = String(
            req.body.title || ''
        ).trim();

        if (
            !title ||
            title.length > 150
        ) {
            throw fail(
                400,
                'Chore title required (up to 150 characters)'
            );
        }

        const chore = await one(
            `INSERT INTO chores(
                household_id,
                title
             )
             VALUES($1,$2)
             RETURNING *`,
            [
                t.household_id,
                title
            ]
        );

        res.status(201).json(chore);
    })
);

app.patch(
    '/my/chores/:id/complete',
    authenticate,
    wrap(async (req, res) => {

        const t = await tenant(req);

        const chore = await one(
            `UPDATE chores
             SET
                status='completed',
                completed_at=now()
             WHERE id=$1
             AND household_id=$2
             AND (
                 assigned_tenant_id IS NULL
                 OR assigned_tenant_id=$3
             )
             RETURNING *`,
            [
                req.params.id,
                t.household_id,
                t.id
            ]
        );

        if (!chore) {
            throw fail(
                404,
                'Chore not found or not assigned to you'
            );
        }

        res.json(chore);
    })
);

// =====================================================
// 15. SHARED GROCERIES
// =====================================================

// IMPORTANT:
// These specific GET routes must be registered
// BEFORE the generic GET /my/:type route.

// GET ALL GROCERIES

app.get(
    '/my/groceries',
    authenticate,
    wrap(async (req, res) => {

        const t = await ownHousehold(req);

        const groceries = await q(
            `SELECT *
             FROM groceries
             WHERE household_id=$1
             ORDER BY created_at DESC`,
            [t.household_id]
        );

        res.json(groceries.rows);
    })
);

// ADD GROCERY

app.post(
    '/my/groceries',
    authenticate,
    wrap(async (req, res) => {

        const t = await ownHousehold(req);

        const title = String(
            req.body.title || ''
        ).trim();

        if (
            !title ||
            title.length > 150
        ) {
            throw fail(
                400,
                'Item name required'
            );
        }

        const grocery = await one(
            `INSERT INTO groceries(
                household_id,
                created_by,
                title
             )
             VALUES($1,$2,$3)
             RETURNING *`,
            [
                t.household_id,
                req.user.id,
                title
            ]
        );

        res.status(201).json(grocery);
    })
);

// MARK GROCERY PURCHASED

app.patch(
    '/my/groceries/:id/purchased',
    authenticate,
    wrap(async (req, res) => {

        const t = await ownHousehold(req);

        const grocery = await one(
            `UPDATE groceries
             SET purchased=true
             WHERE id=$1
             AND household_id=$2
             RETURNING *`,
            [
                req.params.id,
                t.household_id
            ]
        );

        if (!grocery) {
            throw fail(
                404,
                'Item not found'
            );
        }

        res.json(grocery);
    })
);

// =====================================================
// 16. KITCHEN AND BRAAI BOOKINGS
// =====================================================

// GET BOOKINGS

app.get(
    '/my/bookings',
    authenticate,
    wrap(async (req, res) => {

        const t = await ownHousehold(req);

        const bookings = await q(
            `SELECT *
             FROM kitchen_bookings
             WHERE household_id=$1
             ORDER BY starts_at DESC`,
            [t.household_id]
        );

        res.json(bookings.rows);
    })
);

// CREATE BOOKING

app.post(
    '/my/bookings',
    authenticate,
    wrap(async (req, res) => {

        const t = await ownHousehold(req);

        const {
            title,
            starts_at,
            ends_at
        } = req.body;

        const validTitle =
            String(title || '').trim();

        const startTime =
            Date.parse(starts_at);

        const endTime =
            Date.parse(ends_at);

        if (
            !validTitle ||
            !starts_at ||
            !ends_at ||
            !Number.isFinite(startTime) ||
            !Number.isFinite(endTime) ||
            endTime <= startTime
        ) {
            throw fail(
                400,
                'Title and valid start/end times required'
            );
        }

        // Prevent overlapping bookings.

        const conflict = await one(
            `SELECT id
             FROM kitchen_bookings
             WHERE household_id=$1
             AND starts_at<$3
             AND ends_at>$2
             LIMIT 1`,
            [
                t.household_id,
                starts_at,
                ends_at
            ]
        );

        if (conflict) {
            throw fail(
                409,
                'Another booking overlaps this time'
            );
        }

        const booking = await one(
            `INSERT INTO kitchen_bookings(
                household_id,
                created_by,
                title,
                starts_at,
                ends_at
             )
             VALUES($1,$2,$3,$4,$5)
             RETURNING *`,
            [
                t.household_id,
                req.user.id,
                validTitle,
                starts_at,
                ends_at
            ]
        );

        res.status(201).json(booking);
    })
);

// =====================================================
// 17. GENERIC TENANT GET ROUTE
// =====================================================

// IMPORTANT FIX:
// This route is intentionally registered AFTER
// /my/groceries and /my/bookings.
//
// Express matches routes in registration order.
// Previously /my/:type intercepted both routes.

app.get(
    '/my/:type',
    authenticate,
    wrap(async (req, res) => {

        const t = await tenant(req);

        const type = req.params.type;

        let sql;
        let params;

        // =============================================
        // INDIVIDUAL RENT
        // =============================================

        if (type === 'rent') {

            sql = `
                SELECT *
                FROM rent
                WHERE tenant_id=$1
                ORDER BY due_date DESC
            `;

            params = [t.id];

        // =============================================
        // INDIVIDUAL PAYMENTS
        // =============================================

        } else if (type === 'payments') {

            sql = `
                SELECT *
                FROM payments
                WHERE tenant_id=$1
                ORDER BY payment_date DESC
            `;

            params = [t.id];

        // =============================================
        // HOUSEHOLD CHORES
        // =============================================

        } else if (type === 'chores') {

            sql = `
                SELECT *
                FROM chores
                WHERE household_id=$1
                ORDER BY due_date DESC NULLS LAST
            `;

            params = [t.household_id];

        // =============================================
        // ANNOUNCEMENTS
        // =============================================

        } else if (type === 'announcements') {

            sql = `
                SELECT *
                FROM announcements
                WHERE household_id=$1
                OR (
                    household_id IS NULL
                    AND manager_id=$2
                )
                ORDER BY created_at DESC
            `;

            params = [
                t.household_id,
                t.manager_id
            ];

        // =============================================
        // EXPENSES
        // =============================================

        } else if (type === 'expenses') {

            sql = `
                SELECT *
                FROM expenses
                WHERE household_id=$1
                ORDER BY created_at DESC
            `;

            params = [t.household_id];

        // =============================================
        // EXPENSE SPLITS
        // =============================================

        } else if (type === 'expense-splits') {

            sql = `
                SELECT es.*
                FROM expense_splits es
                WHERE tenant_id=$1
            `;

            params = [t.id];

        } else {

            throw fail(
                404,
                'Unknown resource'
            );
        }

        if (
            !t.household_id &&
            [
                'chores',
                'announcements',
                'expenses'
            ].includes(type)
        ) {
            return res.json([]);
        }

        const result = await q(
            sql,
            params
        );

        res.json(result.rows);
    })
);

// =====================================================
// 18. HOUSEHOLD EXPENSES
// =====================================================

app.post(
    '/households/:id/expenses',
    authenticate,
    wrap(async (req, res) => {

        await householdAccess(
            req,
            req.params.id
        );

        if (
            !positive(req.body.amount) ||
            !req.body.title?.trim()
        ) {
            throw fail(
                400,
                'Title and positive amount required'
            );
        }

        const expense = await one(
            `INSERT INTO expenses(
                household_id,
                created_by,
                title,
                amount
             )
             VALUES($1,$2,$3,$4)
             RETURNING *`,
            [
                req.params.id,
                req.user.id,
                req.body.title.trim(),
                req.body.amount
            ]
        );

        res.status(201).json(expense);
    })
);

// =====================================================
// 19. MANAGER HOUSEHOLD SETTINGS
// =====================================================

app.patch(
    '/manager/households/:id',
    authenticate,
    roles('manager', 'admin'),
    wrap(async (req, res) => {

        const mid = await managerId(req);

        const type = req.body.type;
        const note = req.body.pinned_note;

        if (
            type !== undefined &&
            ![
                'student_commune',
                'family_home'
            ].includes(type)
        ) {
            throw fail(
                400,
                'Invalid household type'
            );
        }

        if (
            note !== undefined &&
            (
                typeof note !== 'string' ||
                note.length > 1000
            )
        ) {
            throw fail(
                400,
                'Pinned note must be 1000 characters or less'
            );
        }

        const h = await one(
            `UPDATE households h
             SET
                type=coalesce($1,h.type),
                pinned_note=coalesce($2,h.pinned_note)
             FROM units u
             JOIN properties p
                ON p.id=u.property_id
             WHERE h.id=$3
             AND h.unit_id=u.id
             AND p.manager_id=$4
             RETURNING h.*`,
            [
                type ?? null,
                note ?? null,
                req.params.id,
                mid
            ]
        );

        if (!h) {
            throw fail(
                404,
                'Household not found in portfolio'
            );
        }

        res.json(h);
    })
);

// =====================================================
// 20. MANAGER PORTFOLIO
// =====================================================

app.get(
    '/manager/portfolio',
    authenticate,
    roles('manager', 'admin'),
    wrap(async (req, res) => {

        const mid = await managerId(req);

        const [
            manager,
            properties,
            units,
            tenants,
            rents,
            payments
        ] = await Promise.all([

            one(
                `SELECT
                    id,
                    business_name,
                    status
                 FROM managers
                 WHERE id=$1`,
                [mid]
            ),

            q(
                `SELECT *
                 FROM properties
                 WHERE manager_id=$1
                 ORDER BY property_name`,
                [mid]
            ),

            q(
                `SELECT u.*
                 FROM units u
                 JOIN properties p
                    ON p.id=u.property_id
                 WHERE p.manager_id=$1`,
                [mid]
            ),

            q(
                `SELECT
                    t.id,
                    t.user_id,
                    t.manager_id,
                    t.household_id,
                    t.status,
                    u.full_name,
                    u.email
                 FROM tenants t
                 JOIN users u
                    ON u.id=t.user_id
                 WHERE t.manager_id=$1`,
                [mid]
            ),

            q(
                `SELECT r.*
                 FROM rent r
                 JOIN tenants t
                    ON t.id=r.tenant_id
                 WHERE t.manager_id=$1`,
                [mid]
            ),

            q(
                `SELECT pay.*
                 FROM payments pay
                 JOIN tenants t
                    ON t.id=pay.tenant_id
                 WHERE t.manager_id=$1`,
                [mid]
            )
        ]);

        res.json({
            manager,
            properties: properties.rows,
            units: units.rows,
            tenants: tenants.rows,
            rents: rents.rows,
            payments: payments.rows
        });
    })
);

// =====================================================
// 21. ADMIN OVERVIEW
// =====================================================

app.get(
    '/admin/overview',
    authenticate,
    roles('admin'),
    wrap(async (req, res) => {

        const names = {

            managers:
                'SELECT id,business_name,status,created_at FROM managers',

            properties:
                'SELECT id,property_name,address,manager_id FROM properties',

            units:
                'SELECT id FROM units',

            tenants:
                `SELECT
                    t.id,
                    u.full_name,
                    u.email,
                    t.status
                 FROM tenants t
                 JOIN users u
                    ON u.id=t.user_id`,

            rents:
                'SELECT * FROM rent',

            payments:
                'SELECT * FROM payments'
        };

        const out = {};

        for (
            const [key, sql]
            of Object.entries(names)
        ) {

            out[key] = (
                await q(sql)
            ).rows;
        }

        res.json(out);
    })
);

// =====================================================
// 22. UNASSIGNED TENANTS
// =====================================================

app.get(
    '/manager/unassigned-tenants',
    authenticate,
    roles('manager', 'admin'),
    wrap(async (req, res) => {

        const result = await q(
            `SELECT
                t.id,
                u.full_name,
                u.email
             FROM tenants t
             JOIN users u
                ON u.id=t.user_id
             WHERE t.manager_id IS NULL
             ORDER BY t.created_at DESC
             LIMIT 200`
        );

        res.json(result.rows);
    })
);

// =====================================================
// 23. CREATE PROPERTY
// =====================================================

app.post(
    '/manager/properties',
    authenticate,
    roles('manager', 'admin'),
    wrap(async (req, res) => {

        const mid = await managerId(req);

        const {
            property_name,
            address,
            total_units = 0
        } = req.body;

        if (
            !property_name?.trim() ||
            !address?.trim()
        ) {
            throw fail(
                400,
                'Property name and address required'
            );
        }

        const property = await one(
            `INSERT INTO properties(
                manager_id,
                property_name,
                address,
                total_units
             )
             VALUES($1,$2,$3,$4)
             RETURNING *`,
            [
                mid,
                property_name.trim(),
                address.trim(),
                Number(total_units) || 0
            ]
        );

        res.status(201).json(property);
    })
);

// =====================================================
// 24. CREATE UNIT
// =====================================================

app.post(
    '/manager/units',
    authenticate,
    roles('manager', 'admin'),
    wrap(async (req, res) => {

        const mid = await managerId(req);

        const {
            property_id,
            unit_number,
            monthly_rent = 0,
            status = 'available'
        } = req.body;

        const p = await one(
            `SELECT id
             FROM properties
             WHERE id=$1
             AND manager_id=$2`,
            [
                property_id,
                mid
            ]
        );

        if (!p) {
            throw fail(
                403,
                'Property not in your portfolio'
            );
        }

        if (
            !unit_number?.trim() ||
            Number(monthly_rent) < 0
        ) {
            throw fail(
                400,
                'Invalid unit'
            );
        }

        const u = await one(
            `INSERT INTO units(
                property_id,
                unit_number,
                monthly_rent,
                status
             )
             VALUES($1,$2,$3,$4)
             RETURNING *`,
            [
                property_id,
                unit_number.trim(),
                monthly_rent,
                status
            ]
        );

        await q(
            `INSERT INTO households(
                unit_id,
                name
             )
             VALUES($1,$2)`,
            [
                u.id,
                unit_number.trim()
            ]
        );

        res.status(201).json(u);
    })
);

// =====================================================
// 25. ASSIGN TENANT
// =====================================================

app.post(
    '/manager/assign-tenant',
    authenticate,
    roles('manager', 'admin'),
    wrap(async (req, res) => {

        const mid = await managerId(req);

        const {
            tenant_id,
            unit_id
        } = req.body;

        const h = await one(
            `SELECT h.id
             FROM households h
             JOIN units u
                ON u.id=h.unit_id
             JOIN properties p
                ON p.id=u.property_id
             WHERE u.id=$1
             AND p.manager_id=$2`,
            [
                unit_id,
                mid
            ]
        );

        if (!h) {
            throw fail(
                403,
                'Unit not in your portfolio'
            );
        }

        const t = await one(
            `UPDATE tenants
             SET
                manager_id=$1,
                household_id=$2,
                status='active'
             WHERE id=$3
             AND (
                 manager_id IS NULL
                 OR manager_id=$1
             )
             RETURNING *`,
            [
                mid,
                h.id,
                tenant_id
            ]
        );

        if (!t) {
            throw fail(
                404,
                'Unassigned tenant not found'
            );
        }

        res.json(t);
    })
);

// =====================================================
// 26. ALLOCATE INDIVIDUAL RENT
// =====================================================

app.post(
    '/manager/rent',
    authenticate,
    roles('manager', 'admin'),
    wrap(async (req, res) => {

        const {
            tenant_id,
            amount_due,
            due_date
        } = req.body;

        await managerTenant(
            req,
            tenant_id
        );

        if (
            !positive(amount_due) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(
                due_date || ''
            )
        ) {
            throw fail(
                400,
                'Positive rent and YYYY-MM-DD date required'
            );
        }

        const rent = await one(
            `INSERT INTO rent(
                tenant_id,
                amount_due,
                due_date
             )
             VALUES($1,$2,$3)
             RETURNING *`,
            [
                tenant_id,
                amount_due,
                due_date
            ]
        );

        res.status(201).json(rent);
    })
);

// =====================================================
// 27. RECORD TENANT PAYMENT
// =====================================================

// This records manager-confirmed payments.
// It does NOT process money through a gateway.

app.post(
    '/manager/payments',
    authenticate,
    roles('manager', 'admin'),
    wrap(async (req, res) => {

        const {
            rent_id,
            amount,
            payment_method = 'manual',
            reference
        } = req.body;

        const mid = await managerId(req);

        const r = await one(
            `SELECT r.*
             FROM rent r
             JOIN tenants t
                ON t.id=r.tenant_id
             WHERE r.id=$1
             AND t.manager_id=$2`,
            [
                rent_id,
                mid
            ]
        );

        if (!r) {
            throw fail(
                403,
                'Rent not in your portfolio'
            );
        }

        if (
            !positive(amount) ||
            !reference?.trim()
        ) {
            throw fail(
                400,
                'Amount and unique payment reference required'
            );
        }

        const client = await db.connect();

        try {

            await client.query('BEGIN');

            const payment = (
                await client.query(
                    `INSERT INTO payments(
                        rent_id,
                        tenant_id,
                        amount,
                        payment_method,
                        reference
                     )
                     VALUES($1,$2,$3,$4,$5)
                     RETURNING *`,
                    [
                        rent_id,
                        r.tenant_id,
                        amount,
                        payment_method,
                        reference.trim()
                    ]
                )
            ).rows[0];

            const sum = (
                await client.query(
                    `SELECT
                        coalesce(
                            sum(amount),
                            0
                        )::numeric AS paid
                     FROM payments
                     WHERE rent_id=$1`,
                    [rent_id]
                )
            ).rows[0];

            await client.query(
                `UPDATE rent
                 SET status=$1
                 WHERE id=$2`,
                [
                    Number(sum.paid) >=
                    Number(r.amount_due)
                        ? 'paid'
                        : 'partial',

                    rent_id
                ]
            );

            await client.query('COMMIT');

            res.status(201).json(payment);

        } catch (e) {

            await client.query('ROLLBACK');

            throw e;

        } finally {

            client.release();
        }
    })
);

// =====================================================
// 28. MANAGER CREATE CHORE
// =====================================================

app.post(
    '/manager/chores',
    authenticate,
    roles('manager', 'admin'),
    wrap(async (req, res) => {

        const mid = await managerId(req);

        const {
            household_id,
            title,
            assigned_tenant_id = null,
            due_date = null
        } = req.body;

        const h = await one(
            `SELECT 1
             FROM households h
             JOIN units u
                ON u.id=h.unit_id
             JOIN properties p
                ON p.id=u.property_id
             WHERE h.id=$1
             AND p.manager_id=$2`,
            [
                household_id,
                mid
            ]
        );

        if (!h) {
            throw fail(
                403,
                'Household not in your portfolio'
            );
        }

        if (assigned_tenant_id) {

            const t = await one(
                `SELECT 1
                 FROM tenants
                 WHERE id=$1
                 AND household_id=$2`,
                [
                    assigned_tenant_id,
                    household_id
                ]
            );

            if (!t) {
                throw fail(
                    400,
                    'Tenant not in this household'
                );
            }
        }

        if (!title?.trim()) {
            throw fail(
                400,
                'Chore title required'
            );
        }

        const chore = await one(
            `INSERT INTO chores(
                household_id,
                title,
                assigned_tenant_id,
                due_date
             )
             VALUES($1,$2,$3,$4)
             RETURNING *`,
            [
                household_id,
                title.trim(),
                assigned_tenant_id,
                due_date
            ]
        );

        res.status(201).json(chore);
    })
);

// =====================================================
// 29. MANAGER ANNOUNCEMENTS
// =====================================================

app.post(
    '/manager/announcements',
    authenticate,
    roles('manager', 'admin'),
    wrap(async (req, res) => {

        const mid = await managerId(req);

        const {
            household_id = null,
            title,
            body
        } = req.body;

        if (household_id) {

            const h = await one(
                `SELECT 1
                 FROM households h
                 JOIN units u
                    ON u.id=h.unit_id
                 JOIN properties p
                    ON p.id=u.property_id
                 WHERE h.id=$1
                 AND p.manager_id=$2`,
                [
                    household_id,
                    mid
                ]
            );

            if (!h) {
                throw fail(
                    403,
                    'Household not in your portfolio'
                );
            }
        }

        if (
            !title?.trim() ||
            !body?.trim()
        ) {
            throw fail(
                400,
                'Title and message required'
            );
        }

        const announcement = await one(
            `INSERT INTO announcements(
                household_id,
                manager_id,
                title,
                body
             )
             VALUES($1,$2,$3,$4)
             RETURNING *`,
            [
                household_id,
                mid,
                title.trim(),
                body.trim()
            ]
        );

        res.status(201).json(
            announcement
        );
    })
);

// =====================================================
// 30. ADMIN CREATE MANAGER
// =====================================================

app.post(
    '/admin/managers',
    authenticate,
    roles('admin'),
    wrap(async (req, res) => {

        const {
            email,
            password,
            full_name,
            business_name
        } = req.body;

        if (
            !email ||
            !full_name ||
            !business_name ||
            !password ||
            password.length < 8
        ) {
            throw fail(
                400,
                'All fields and 8+ character password required'
            );
        }

        const client = await db.connect();

        try {

            await client.query('BEGIN');

            const hash = await bcrypt.hash(
                password,
                12
            );

            const u = (
                await client.query(
                    `INSERT INTO users(
                        email,
                        password_hash,
                        full_name,
                        role
                     )
                     VALUES($1,$2,$3,'manager')
                     RETURNING id`,
                    [
                        email.trim().toLowerCase(),
                        hash,
                        full_name
                    ]
                )
            ).rows[0];

            const m = (
                await client.query(
                    `INSERT INTO managers(
                        user_id,
                        business_name
                     )
                     VALUES($1,$2)
                     RETURNING *`,
                    [
                        u.id,
                        business_name
                    ]
                )
            ).rows[0];

            await client.query('COMMIT');

            res.status(201).json(m);

        } catch (e) {

            await client.query('ROLLBACK');

            throw e;

        } finally {

            client.release();
        }
    })
);

// =====================================================
// 31. FIRST ADMIN SETUP
// =====================================================

// Only works when no admin exists and
// BOOTSTRAP_SECRET is configured.

app.post(
    '/setup/first-admin',
    authLimit,
    wrap(async (req, res) => {

        if (
            !process.env.BOOTSTRAP_SECRET ||
            req.headers['x-bootstrap-secret'] !==
                process.env.BOOTSTRAP_SECRET
        ) {
            throw fail(
                403,
                'Setup disabled'
            );
        }

        const existing = await one(
            `SELECT id
             FROM users
             WHERE role='admin'
             LIMIT 1`
        );

        if (existing) {
            throw fail(
                403,
                'Admin already exists'
            );
        }

        const {
            email,
            password,
            full_name
        } = req.body;

        if (
            !/^\S+@\S+\.\S+$/.test(email || '') ||
            !full_name ||
            !password ||
            password.length < 12
        ) {
            throw fail(
                400,
                'Email, name and 12+ character password required'
            );
        }

        const hash = await bcrypt.hash(
            password,
            12
        );

        const admin = await one(
            `INSERT INTO users(
                email,
                password_hash,
                full_name,
                role
             )
             VALUES($1,$2,$3,'admin')
             RETURNING
                id,
                email,
                role`,
            [
                email.trim().toLowerCase(),
                hash,
                full_name
            ]
        );

        res.status(201).json(admin);
    })
);

// =====================================================
// 32. GET HOUSEHOLD FOR UNIT
// =====================================================

app.get(
    '/manager/household-for-unit/:id',
    authenticate,
    roles('manager', 'admin'),
    wrap(async (req, res) => {

        const mid = await managerId(req);

        const h = await one(
            `SELECT
                h.id,
                h.name
             FROM households h
             JOIN units u
                ON u.id=h.unit_id
             JOIN properties p
                ON p.id=u.property_id
             WHERE u.id=$1
             AND p.manager_id=$2`,
            [
                req.params.id,
                mid
            ]
        );

        if (!h) {
            throw fail(
                404,
                'Household not found'
            );
        }

        res.json(h);
    })
);

// =====================================================
// 33. MANAGER AND ADMIN WEBSITES
// =====================================================

const dirname = path.dirname(
    fileURLToPath(import.meta.url)
);

app.use(
    '/manager',
    express.static(
        path.join(
            dirname,
            'manager-website'
        )
    )
);

app.use(
    '/admin',
    express.static(
        path.join(
            dirname,
            'admin-website'
        )
    )
);

app.get(
    '/',
    (req, res) => {
        res.redirect('/manager/');
    }
);

// =====================================================
// 34. ERROR HANDLING
// =====================================================

app.use(
    (err, req, res, next) => {

        console.error("RENTMATE API ERROR", {
            method: req.method,
            path: req.path,
            code: err.code,
            message: err.message,
            detail: err.detail,
            table: err.table,
            column: err.column
        });

        const status =
            err.status ||
            (
                err.code === '23505'
                    ? 409
                    : err.code === '23503'
                        ? 400
                        : 500
            );

        res.status(status).json({

            detail:
                status === 500
                    ? 'Server error'
                    : err.code === '23505'
                        ? 'Record already exists'
                        : err.message
        });
    }
);

// =====================================================
// 35. START SERVER
// =====================================================

app.listen(
    process.env.PORT || 10000,
    '0.0.0.0',
    () => {
        console.log(
            'RentMate API listening'
        );
    }
);