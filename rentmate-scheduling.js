// RentMate Stage 2 scheduling routes. Registered before legacy handlers.
export function registerRentMateSchedulingRoutes(app, d) {
  const { authenticate, wrap, ownHousehold, one, q, fail, uuid, managerId, roles } = d;
  const text = (value, max = 150) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null;
  const timestamp = (value, label, required = false) => {
    if (value === undefined || value === null || value === '') {
      if (required) throw fail(400, `${label} is required`);
      return null;
    }
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
      throw fail(400, `${label} must be an ISO timestamp with timezone`);
    }
    return new Date(value).toISOString();
  };
  const reminder = value => {
    const n = value === undefined || value === null || value === '' ? 0 : Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 10080) throw fail(400, 'reminder_minutes must be 0 to 10080');
    return n;
  };
  const assignedToHousehold = async (id, householdId) => {
    if (id == null || id === '') return null;
    if (!uuid(id)) throw fail(400, 'Invalid assigned_tenant_id');
    const member = await one('SELECT id FROM tenants WHERE id=$1 AND household_id=$2', [id, householdId]);
    if (!member) throw fail(400, 'Assigned tenant must belong to your household');
    return id;
  };

  // Household-wide visibility; only a member of this household can create/read.
  app.get('/my/chores', authenticate, wrap(async (req, res) => {
    const t = await ownHousehold(req);
    const result = await q('SELECT * FROM chores WHERE household_id=$1 ORDER BY due_at ASC NULLS LAST, created_at DESC', [t.household_id]);
    res.json(result.rows);
  }));
  app.post('/my/chores', authenticate, wrap(async (req, res) => {
    const t = await ownHousehold(req);
    const title = text(req.body.title);
    if (!title) throw fail(400, 'Chore title required (up to 150 characters)');
    const due = timestamp(req.body.due_at, 'due_at');
    const assignee = await assignedToHousehold(req.body.assigned_tenant_id, t.household_id);
    const mins = reminder(req.body.reminder_minutes);
    const row = await one(`INSERT INTO chores (household_id,title,due_at,assigned_tenant_id,reminder_minutes)
      VALUES ($1,$2,$3,$4,$5) RETURNING *`, [t.household_id,title,due,assignee,mins]);
    res.status(201).json(row);
  }));
  app.post('/my/groceries', authenticate, wrap(async (req, res) => {
    const t = await ownHousehold(req);
    const title = text(req.body.title);
    if (!title) throw fail(400, 'Item name required (up to 150 characters)');
    const needed = timestamp(req.body.needed_at, 'needed_at');
    const mins = reminder(req.body.reminder_minutes);
    const row = await one(`INSERT INTO groceries (household_id,created_by,title,needed_at,reminder_minutes)
      VALUES ($1,$2,$3,$4,$5) RETURNING *`, [t.household_id,req.user.id,title,needed,mins]);
    res.status(201).json(row);
  }));
  app.post('/my/bookings', authenticate, wrap(async (req, res) => {
    const t = await ownHousehold(req);
    const title = text(req.body.title);
    if (!title) throw fail(400, 'Booking title required');
    const start = timestamp(req.body.starts_at, 'starts_at', true);
    const end = timestamp(req.body.ends_at, 'ends_at', true);
    if (Date.parse(end) <= Date.parse(start)) throw fail(400, 'End must be after start');
    const mins = reminder(req.body.reminder_minutes);
    // Transaction-level advisory lock serializes booking creation for one household.
    const client = await d.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [t.household_id]);
      const clash = await client.query(`SELECT id FROM kitchen_bookings WHERE household_id=$1
        AND starts_at<$3 AND ends_at>$2 LIMIT 1`, [t.household_id,start,end]);
      if (clash.rowCount) throw fail(409, 'Another booking overlaps this time');
      const result = await client.query(`INSERT INTO kitchen_bookings
        (household_id,created_by,title,starts_at,ends_at,reminder_minutes)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [t.household_id,req.user.id,title,start,end,mins]);
      await client.query('COMMIT');
      res.status(201).json(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  }));
  // Announcements are shared within household, or manager-wide where household_id is NULL.
  app.post('/my/announcements', authenticate, wrap(async (req, res) => {
    const t = await ownHousehold(req);
    const title = text(req.body.title);
    const body = text(req.body.body, 3000);
    if (!title || !body) throw fail(400, 'Title and message required');
    const event = timestamp(req.body.event_at, 'event_at');
    const mins = reminder(req.body.reminder_minutes);
    const row = await one(`INSERT INTO announcements (household_id,manager_id,title,body,event_at,reminder_minutes)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [t.household_id,t.manager_id,title,body,event,mins]);
    res.status(201).json(row);
  }));
  app.post('/manager/announcements', authenticate, roles('manager','admin'), wrap(async (req, res) => {
    const mid = await managerId(req);
    const hid = req.body.household_id ?? null;
    if (hid !== null) {
      if (!uuid(hid)) throw fail(400, 'Invalid household_id');
      const h = await one(`SELECT 1 FROM households h JOIN units u ON u.id=h.unit_id
        JOIN properties p ON p.id=u.property_id WHERE h.id=$1 AND p.manager_id=$2`, [hid,mid]);
      if (!h) throw fail(403, 'Household not in your portfolio');
    }
    const title = text(req.body.title);
    const body = text(req.body.body, 3000);
    if (!title || !body) throw fail(400, 'Title and message required');
    const event = timestamp(req.body.event_at, 'event_at');
    const mins = reminder(req.body.reminder_minutes);
    const row = await one(`INSERT INTO announcements (household_id,manager_id,title,body,event_at,reminder_minutes)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [hid,mid,title,body,event,mins]);
    res.status(201).json(row);
  }));
  app.get('/my/events', authenticate, wrap(async (req, res) => {
    const t = await ownHousehold(req);
    const result = await q('SELECT * FROM household_events WHERE household_id=$1 ORDER BY starts_at ASC', [t.household_id]);
    res.json(result.rows);
  }));
  app.post('/my/events', authenticate, wrap(async (req, res) => {
    const t = await ownHousehold(req);
    const title = text(req.body.title);
    if (!title) throw fail(400, 'Event title required');
    const start = timestamp(req.body.starts_at, 'starts_at', true);
    const end = timestamp(req.body.ends_at, 'ends_at');
    if (end && Date.parse(end) <= Date.parse(start)) throw fail(400, 'End must be after start');
    const mins = reminder(req.body.reminder_minutes);
    const row = await one(`INSERT INTO household_events (household_id,created_by,title,starts_at,ends_at,reminder_minutes)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [t.household_id,req.user.id,title,start,end,mins]);
    res.status(201).json(row);
  }));
}
