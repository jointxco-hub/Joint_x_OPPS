import { supabase } from '@/lib/supabaseClient';

const localStore = new Map();
const warnedEntities = new Set();
let currentUser = null;

const ORDER_STATUS_MAP = {
  received: 'confirmed',
  materials_needed: 'confirmed',
  confirmed: 'confirmed',
  in_production: 'in_production',
  ready: 'ready',
  out_for_delivery: 'shipped',
  shipped: 'shipped',
  delivered: 'delivered',
  cancelled: 'cancelled',
};

const TASK_STATUS_MAP = {
  todo: 'pending',
  pending: 'pending',
  in_progress: 'in_progress',
  done: 'done',
  complete: 'done',
  overdue: 'overdue',
};

const PRIORITY_MAP = {
  low: 'low',
  medium: 'medium',
  normal: 'normal',
  high: 'high',
  urgent: 'urgent',
};

const DERIVED_ENTITY_NAMES = new Set(['Client', 'Supplier']);

const ENTITY_CONFIG = {
  Order: {
    table: 'orders',
    sortMap: {
      created_date: 'created_at',
      updated_date: 'updated_at',
      archived_at: 'archived_at',
      due_date: 'due_date',
    },
    filterMap: {
      created_date: 'created_at',
      updated_date: 'updated_at',
      quoted_price: 'total_amount',
      tracking_code: 'tracking_number',
    },
    normalize(row) {
      const products = Array.isArray(row.products) ? row.products : [];
      return {
        ...row,
        created_date: row.created_at,
        updated_date: row.updated_at,
        quoted_price: Number(row.total_amount ?? 0),
        tracking_code: row.tracking_number ?? '',
        quantity:
          row.quantity ??
          products.reduce((sum, item) => sum + Number(item?.quantity ?? 0), 0),
      };
    },
    serialize(payload) {
      const sanitizedProducts = Array.isArray(payload.products)
        ? payload.products
        : payload.quantity && !payload.products
          ? [
              {
                name: payload.blank_type || payload.product_name || 'Item',
                quantity: Number(payload.quantity) || 1,
                price: Number(payload.quoted_price ?? payload.total_amount ?? 0),
              },
            ]
          : [];

      return compactObject({
        client_name: payload.client_name,
        client_email: payload.client_email,
        client_phone: payload.client_phone,
        order_number: payload.order_number,
        status: normalizeOrderStatus(payload.status),
        priority: normalizeOrderPriority(payload.priority),
        products: sanitizedProducts,
        total_amount: numberOrUndefined(payload.total_amount ?? payload.quoted_price),
        deposit_paid: numberOrUndefined(payload.deposit_paid),
        notes: payload.notes ?? payload.description,
        special_instructions: payload.special_instructions,
        due_date: payload.due_date,
        courier: payload.courier,
        tracking_number: payload.tracking_number ?? payload.tracking_code,
        file_urls: payload.file_urls,
        assigned_team: payload.assigned_team,
        print_type: normalizePrintType(payload.print_type),
        linked_po_id: payload.linked_po_id,
        is_archived: payload.is_archived,
        archived_at: payload.archived_at,
        archived_by: payload.archived_by,
        source: payload.source,
      });
    },
  },
  Task: {
    table: 'tasks',
    sortMap: {
      created_date: 'created_at',
      updated_date: 'updated_at',
      archived_at: 'archived_at',
      due_date: 'deadline',
    },
    filterMap: {
      created_date: 'created_at',
      updated_date: 'updated_at',
      due_date: 'deadline',
      project_id: 'linked_goal_id',
    },
    normalize(row) {
      return {
        ...row,
        created_date: row.created_at,
        updated_date: row.updated_at,
        due_date: row.deadline,
        project_id: row.linked_goal_id,
      };
    },
    serialize(payload) {
      return compactObject({
        title: payload.title ?? payload.name,
        description: payload.description,
        assigned_to: payload.assigned_to,
        assigned_to_name: payload.assigned_to_name,
        assigned_user_id: payload.assigned_user_id,
        deadline: payload.deadline ?? payload.due_date,
        week_number: numberOrUndefined(payload.week_number),
        status: normalizeTaskStatus(payload.status),
        priority: normalizeTaskPriority(payload.priority),
        department: payload.department,
        linked_order_id: payload.linked_order_id,
        linked_goal_id: payload.linked_goal_id ?? payload.project_id,
        file_urls: payload.file_urls,
        comments: payload.comments,
        is_archived: payload.is_archived,
        archived_at: payload.archived_at,
        archived_by: payload.archived_by,
      });
    },
  },
  InventoryItem: {
    table: 'inventory',
    sortMap: {
      created_date: 'created_at',
      updated_date: 'updated_at',
    },
    filterMap: {
      created_date: 'created_at',
      updated_date: 'updated_at',
    },
    normalize(row) {
      return {
        ...row,
        created_date: row.created_at,
        updated_date: row.updated_at,
      };
    },
    serialize(payload) {
      return compactObject({
        name: payload.name,
        sku: payload.sku,
        category: payload.category ?? 'other',
        current_stock: numberOrUndefined(payload.current_stock ?? payload.stock),
        unit: payload.unit,
        reorder_point: numberOrUndefined(payload.reorder_point),
        reorder_quantity: numberOrUndefined(payload.reorder_quantity),
        last_reorder_date: payload.last_reorder_date,
        sizes_available: payload.sizes_available,
        colors_available: payload.colors_available,
        cost_price: numberOrUndefined(payload.cost_price),
        selling_price: numberOrUndefined(payload.selling_price),
        location: payload.location,
        is_archived: payload.is_archived,
        archived_at: payload.archived_at,
      });
    },
  },
  User: {
    table: 'users',
    sortMap: {
      created_date: 'created_at',
      updated_date: 'updated_at',
      email: 'user_email',
      name: 'full_name',
    },
    filterMap: {
      email: 'user_email',
      name: 'full_name',
      created_date: 'created_at',
      updated_date: 'updated_at',
      profile_photo: 'avatar_url',
    },
    normalize(row) {
      return {
        ...row,
        email: row.user_email,
        name: row.full_name,
        profile_photo: row.avatar_url,
        created_date: row.created_at,
        updated_date: row.updated_at,
      };
    },
    serialize(payload) {
      return compactObject({
        auth_user_id: payload.auth_user_id,
        user_email: payload.user_email ?? payload.email,
        full_name: payload.full_name ?? payload.name,
        role: payload.role,
        department: payload.department,
        phone: payload.phone,
        avatar_url: payload.avatar_url ?? payload.profile_photo,
        bio: payload.bio,
        skills: payload.skills,
        is_active: payload.is_active,
      });
    },
  },
  TeamMember: {
    table: 'users',
    sortMap: {
      created_date: 'created_at',
      updated_date: 'updated_at',
      email: 'user_email',
      name: 'full_name',
    },
    filterMap: {
      email: 'user_email',
      name: 'full_name',
      created_date: 'created_at',
      updated_date: 'updated_at',
    },
    normalize(row) {
      return ENTITY_CONFIG.User.normalize(row);
    },
    serialize(payload) {
      return ENTITY_CONFIG.User.serialize(payload);
    },
  },
  Payment: {
    table: 'transactions',
    baseFilter: { type: 'income' },
    sortMap: {
      created_date: 'created_at',
      updated_date: 'updated_at',
      date: 'payment_date',
    },
    filterMap: {
      created_date: 'created_at',
      updated_date: 'updated_at',
      date: 'payment_date',
      quoted_price: 'amount',
    },
    normalize(row) {
      return {
        ...row,
        created_date: row.created_at,
        updated_date: row.updated_at,
        date: row.payment_date,
      };
    },
    serialize(payload) {
      return compactObject({
        type: 'income',
        order_id: payload.order_id,
        order_number: payload.order_number,
        client_name: payload.client_name,
        invoice_number: payload.invoice_number,
        payment_date: payload.payment_date ?? payload.date,
        payment_status: payload.payment_status,
        payment_method: payload.payment_method,
        tax_amount: numberOrUndefined(payload.tax_amount),
        is_offline: payload.is_offline,
        synced: payload.synced,
        amount: numberOrUndefined(payload.amount ?? payload.total_amount),
        notes: payload.notes,
      });
    },
  },
  Expense: {
    table: 'transactions',
    baseFilter: { type: 'expense' },
    sortMap: {
      created_date: 'created_at',
      updated_date: 'updated_at',
      date: 'expense_date',
    },
    filterMap: {
      created_date: 'created_at',
      updated_date: 'updated_at',
      date: 'expense_date',
    },
    normalize(row) {
      return {
        ...row,
        created_date: row.created_at,
        updated_date: row.updated_at,
        date: row.expense_date,
      };
    },
    serialize(payload) {
      return compactObject({
        type: 'expense',
        expense_date: payload.expense_date ?? payload.date,
        vendor: payload.vendor,
        expense_category: payload.expense_category ?? payload.category,
        vat_type: payload.vat_type,
        vat_amount: numberOrUndefined(payload.vat_amount),
        receipt_urls: payload.receipt_urls,
        project_id: payload.project_id,
        client_id: payload.client_id,
        amount: numberOrUndefined(payload.amount ?? payload.total_amount),
        notes: payload.notes,
      });
    },
  },
};

function numberOrUndefined(value) {
  if (value == null || value === '') {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined)
  );
}

function slugify(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getLocalRows(entityName) {
  if (!localStore.has(entityName)) {
    localStore.set(entityName, []);
  }

  return localStore.get(entityName);
}

function createLocalId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function warnUnsupportedEntity(entityName) {
  if (DERIVED_ENTITY_NAMES.has(entityName)) {
    return;
  }

  if (!warnedEntities.has(entityName)) {
    warnedEntities.add(entityName);
    console.warn(
      `[dataClient] ${entityName} is not in the current Supabase Phase 1 schema. Using local fallback only.`
    );
  }
}

function warnDerivedWriteFallback(entityName) {
  const warningKey = `${entityName}:write`;
  if (!warnedEntities.has(warningKey)) {
    warnedEntities.add(warningKey);
    console.warn(
      `[dataClient] ${entityName} write operations are not supported by the Phase 1 Supabase schema. Using local fallback for writes.`
    );
  }
}

function toTimestamp(value) {
  if (!value) {
    return 0;
  }

  const normalized = String(value).replace(/^-/, '');
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortRows(rows, sort) {
  if (!sort) {
    return rows;
  }

  const descending = sort.startsWith('-');
  const field = descending ? sort.slice(1) : sort;

  return [...rows].sort((left, right) => {
    const leftValue = left?.[field];
    const rightValue = right?.[field];

    if (leftValue == null && rightValue == null) return 0;
    if (leftValue == null) return 1;
    if (rightValue == null) return -1;

    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      return descending ? rightValue - leftValue : leftValue - rightValue;
    }

    const dateDiff = toTimestamp(leftValue) - toTimestamp(rightValue);
    if (dateDiff !== 0) {
      return descending ? -dateDiff : dateDiff;
    }

    const compare = String(leftValue).localeCompare(String(rightValue));
    return descending ? -compare : compare;
  });
}

function filterRows(rows, filter = {}) {
  return rows.filter((row) =>
    Object.entries(filter).every(([key, value]) => row?.[key] === value)
  );
}

function normalizeOrderStatus(status) {
  if (!status) {
    return undefined;
  }

  return ORDER_STATUS_MAP[status] ?? status;
}

function normalizeTaskStatus(status) {
  if (!status) {
    return undefined;
  }

  return TASK_STATUS_MAP[status] ?? status;
}

function normalizeOrderPriority(priority) {
  if (!priority) {
    return undefined;
  }

  return PRIORITY_MAP[priority] === 'medium' ? 'normal' : PRIORITY_MAP[priority] ?? priority;
}

function normalizeTaskPriority(priority) {
  if (!priority) {
    return undefined;
  }

  return PRIORITY_MAP[priority] ?? priority;
}

function normalizePrintType(printType) {
  if (!printType) {
    return undefined;
  }

  const normalized = String(printType).toLowerCase();
  if (normalized.startsWith('dtf')) return 'dtf';
  if (normalized.startsWith('vinyl')) return 'vinyl';
  if (normalized.startsWith('embroidery')) return 'embroidery';
  if (normalized.startsWith('screen')) return 'screen';
  if (normalized === 'none') return 'none';
  return undefined;
}

function getSortColumn(entityConfig, sort) {
  if (!sort) {
    return null;
  }

  const descending = sort.startsWith('-');
  const requestedField = descending ? sort.slice(1) : sort;
  const column = entityConfig.sortMap?.[requestedField] ?? requestedField;
  return { column, ascending: !descending };
}

function mapFilter(entityConfig, filter = {}) {
  return Object.fromEntries(
    Object.entries(filter).map(([key, value]) => [
      entityConfig.filterMap?.[key] ?? key,
      key === 'status' && entityConfig === ENTITY_CONFIG.Order
        ? normalizeOrderStatus(value)
        : key === 'status' && entityConfig === ENTITY_CONFIG.Task
          ? normalizeTaskStatus(value)
          : key === 'priority' && entityConfig === ENTITY_CONFIG.Order
            ? normalizeOrderPriority(value)
            : key === 'priority' && entityConfig === ENTITY_CONFIG.Task
              ? normalizeTaskPriority(value)
              : value,
    ])
  );
}

async function runSelect(entityName, filter = {}, sort, limit) {
  if (!supabase) {
    return null;
  }

  const entityConfig = ENTITY_CONFIG[entityName];
  if (!entityConfig) {
    return null;
  }

  let query = supabase.from(entityConfig.table).select('*');
  const combinedFilter = {
    ...(entityConfig.baseFilter ?? {}),
    ...mapFilter(entityConfig, filter),
  };

  for (const [key, value] of Object.entries(combinedFilter)) {
    query = query.eq(key, value);
  }

  const sortConfig = getSortColumn(entityConfig, sort);
  if (sortConfig) {
    query = query.order(sortConfig.column, { ascending: sortConfig.ascending });
  }

  if (typeof limit === 'number') {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    console.warn(`[dataClient] ${entityName} query failed:`, error.message);
    return null;
  }

  return (data ?? []).map((row) => entityConfig.normalize(row));
}

async function runInsert(entityName, payload = {}) {
  if (!supabase) {
    return null;
  }

  const entityConfig = ENTITY_CONFIG[entityName];
  if (!entityConfig) {
    return null;
  }

  const record = entityConfig.serialize(payload);
  const { data, error } = await supabase
    .from(entityConfig.table)
    .insert(record)
    .select('*')
    .single();

  if (error) {
    console.warn(`[dataClient] ${entityName} create failed:`, error.message);
    return null;
  }

  return entityConfig.normalize(data);
}

async function runUpdate(entityName, id, payload = {}) {
  if (!supabase) {
    return null;
  }

  const entityConfig = ENTITY_CONFIG[entityName];
  if (!entityConfig) {
    return null;
  }

  const record = entityConfig.serialize(payload);
  const { data, error } = await supabase
    .from(entityConfig.table)
    .update(record)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    console.warn(`[dataClient] ${entityName} update failed:`, error.message);
    return null;
  }

  return entityConfig.normalize(data);
}

async function runDelete(entityName, id) {
  if (!supabase) {
    return false;
  }

  const entityConfig = ENTITY_CONFIG[entityName];
  if (!entityConfig) {
    return false;
  }

  const { error } = await supabase.from(entityConfig.table).delete().eq('id', id);
  if (error) {
    console.warn(`[dataClient] ${entityName} delete failed:`, error.message);
    return false;
  }

  return true;
}

async function runDerivedClientSelect(filter = {}, sort, limit = 100) {
  if (!supabase) {
    return null;
  }

  let query = supabase
    .from('orders')
    .select('client_name, client_email, client_phone, created_at, updated_at, is_archived')
    .order('updated_at', { ascending: false });

  if (filter.is_archived != null) {
    query = query.eq('is_archived', filter.is_archived);
  }

  if (filter.client_name) {
    query = query.eq('client_name', filter.client_name);
  }

  if (filter.client_email) {
    query = query.eq('client_email', filter.client_email);
  }

  const { data, error } = await query.limit(Math.max(limit * 5, 200));

  if (error) {
    console.warn('[dataClient] Client query failed:', error.message);
    return null;
  }

  const deduped = new Map();
  for (const row of data ?? []) {
    const key = row.client_email || row.client_name;
    if (!key || deduped.has(key)) {
      continue;
    }

    deduped.set(key, {
      id: `client-${slugify(key)}`,
      name: row.client_name,
      client_name: row.client_name,
      email: row.client_email,
      client_email: row.client_email,
      phone: row.client_phone,
      client_phone: row.client_phone,
      is_archived: row.is_archived ?? false,
      created_date: row.created_at,
      updated_date: row.updated_at,
    });
  }

  return sortRows(
    filterRows(Array.from(deduped.values()), normalizeDerivedFilter(filter)),
    sort
  ).slice(0, limit);
}

async function runDerivedSupplierSelect(filter = {}, sort, limit = 100) {
  if (!supabase) {
    return null;
  }

  let query = supabase
    .from('transactions')
    .select('vendor, created_at, updated_at')
    .eq('type', 'expense')
    .not('vendor', 'is', null)
    .order('updated_at', { ascending: false });

  const { data, error } = await query.limit(Math.max(limit * 5, 200));

  if (error) {
    console.warn('[dataClient] Supplier query failed:', error.message);
    return null;
  }

  const deduped = new Map();
  for (const row of data ?? []) {
    const key = row.vendor;
    if (!key || deduped.has(key)) {
      continue;
    }

    deduped.set(key, {
      id: `supplier-${slugify(key)}`,
      name: row.vendor,
      vendor: row.vendor,
      created_date: row.created_at,
      updated_date: row.updated_at,
    });
  }

  return sortRows(
    filterRows(Array.from(deduped.values()), normalizeDerivedFilter(filter)),
    sort
  ).slice(0, limit);
}

function normalizeDerivedFilter(filter = {}) {
  return Object.fromEntries(
    Object.entries(filter).map(([key, value]) => {
      if (key === 'client_name') return ['name', value];
      if (key === 'client_email') return ['email', value];
      return [key, value];
    })
  );
}

async function handleLocalEntity(entityName, operation, ...args) {
  warnUnsupportedEntity(entityName);
  const rows = getLocalRows(entityName);

  if (operation === 'list') {
    const [sort, limit = 100] = args;
    return sortRows(rows, sort).slice(0, limit);
  }

  if (operation === 'filter') {
    const [filter = {}, sort, limit = 100] = args;
    return sortRows(filterRows(rows, filter), sort).slice(0, limit);
  }

  if (operation === 'create') {
    const [payload = {}] = args;
    const row = {
      id: payload.id ?? createLocalId(),
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString(),
      ...payload,
    };
    rows.unshift(row);
    return row;
  }

  if (operation === 'update') {
    const [id, payload = {}] = args;
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) {
      const row = { id, updated_date: new Date().toISOString(), ...payload };
      rows.unshift(row);
      return row;
    }

    rows[index] = {
      ...rows[index],
      ...payload,
      updated_date: new Date().toISOString(),
    };

    return rows[index];
  }

  if (operation === 'delete') {
    const [id] = args;
    const index = rows.findIndex((row) => row.id === id);
    if (index !== -1) {
      rows.splice(index, 1);
    }
    return true;
  }

  return null;
}

function createEntityApi(entityName) {
  const isSupported = Boolean(ENTITY_CONFIG[entityName]);

  return {
    async list(sort, limit = 100) {
      if (entityName === 'Client') {
        const rows = await runDerivedClientSelect({}, sort, limit);
        if (rows) {
          return rows;
        }
      }

      if (entityName === 'Supplier') {
        const rows = await runDerivedSupplierSelect({}, sort, limit);
        if (rows) {
          return rows;
        }
      }

      if (isSupported) {
        const rows = await runSelect(entityName, {}, sort, limit);
        if (rows) {
          return rows;
        }
      }

      return handleLocalEntity(entityName, 'list', sort, limit);
    },

    async filter(filter = {}, sort, limit = 100) {
      if (entityName === 'Client') {
        const rows = await runDerivedClientSelect(filter, sort, limit);
        if (rows) {
          return rows;
        }
      }

      if (entityName === 'Supplier') {
        const rows = await runDerivedSupplierSelect(filter, sort, limit);
        if (rows) {
          return rows;
        }
      }

      if (isSupported) {
        const rows = await runSelect(entityName, filter, sort, limit);
        if (rows) {
          return rows;
        }
      }

      return handleLocalEntity(entityName, 'filter', filter, sort, limit);
    },

    async create(payload = {}) {
      if (entityName === 'Client' || entityName === 'Supplier') {
        warnDerivedWriteFallback(entityName);
      }

      if (isSupported) {
        const row = await runInsert(entityName, payload);
        if (row) {
          return row;
        }
      }

      return handleLocalEntity(entityName, 'create', payload);
    },

    async update(id, payload = {}) {
      if (entityName === 'Client' || entityName === 'Supplier') {
        warnDerivedWriteFallback(entityName);
      }

      if (isSupported) {
        const row = await runUpdate(entityName, id, payload);
        if (row) {
          return row;
        }
      }

      return handleLocalEntity(entityName, 'update', id, payload);
    },

    async delete(id) {
      if (entityName === 'Client' || entityName === 'Supplier') {
        warnDerivedWriteFallback(entityName);
      }

      if (isSupported) {
        const deleted = await runDelete(entityName, id);
        if (deleted) {
          return true;
        }
      }

      return handleLocalEntity(entityName, 'delete', id);
    },
  };
}

const entityCache = new Map();

const entities = new Proxy(
  {},
  {
    get(_, entityName) {
      if (!entityCache.has(entityName)) {
        entityCache.set(entityName, createEntityApi(entityName));
      }

      return entityCache.get(entityName);
    },
  }
);

async function getCurrentUser() {
  if (!supabase) {
    return currentUser;
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    return currentUser;
  }

  const authUser = data.user;
  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .or(`auth_user_id.eq.${authUser.id},user_email.eq.${authUser.email}`)
    .limit(1)
    .maybeSingle();

  currentUser = {
    id: authUser.id,
    email: authUser.email,
    full_name:
      profile?.full_name ??
      authUser.user_metadata?.full_name ??
      authUser.user_metadata?.name ??
      authUser.email ??
      'Supabase User',
    role: profile?.role ?? authUser.user_metadata?.role ?? 'user',
    department: profile?.department,
    phone: profile?.phone,
    profile_photo: profile?.avatar_url ?? authUser.user_metadata?.avatar_url ?? null,
    auth_user_id: authUser.id,
  };

  return currentUser;
}

export const dataClient = {
  entities,
  auth: {
    async me() {
      return getCurrentUser();
    },

    async updateMe(payload = {}) {
      const user = await getCurrentUser();
      if (!user) {
        currentUser = {
          ...(currentUser ?? {}),
          ...payload,
        };
        return currentUser;
      }

      if (supabase) {
        const profilePayload = ENTITY_CONFIG.User.serialize({
          ...user,
          ...payload,
          auth_user_id: user.id,
          user_email: payload.email ?? user.email,
        });

        const { data: existingProfile } = await supabase
          .from('users')
          .select('id')
          .or(`auth_user_id.eq.${user.id},user_email.eq.${user.email}`)
          .limit(1)
          .maybeSingle();

        if (existingProfile?.id) {
          await supabase.from('users').update(profilePayload).eq('id', existingProfile.id);
        } else {
          await supabase.from('users').insert(profilePayload);
        }

        await supabase.auth.updateUser({
          data: {
            full_name: payload.full_name ?? payload.name ?? user.full_name,
            avatar_url: payload.profile_photo ?? payload.avatar_url ?? user.profile_photo,
            role: payload.role ?? user.role,
          },
        });
      }

      currentUser = {
        ...user,
        ...payload,
        email: payload.email ?? user.email,
        full_name: payload.full_name ?? payload.name ?? user.full_name,
        profile_photo: payload.profile_photo ?? payload.avatar_url ?? user.profile_photo,
      };

      return currentUser;
    },

    async logout() {
      if (supabase) {
        await supabase.auth.signOut();
      }
      currentUser = null;
    },

    redirectToLogin() {
      console.info('[dataClient] Supabase auth redirect is not configured.');
    },
  },
  integrations: {
    Core: {
      async UploadFile({ file }) {
        return {
          file_url: file ? URL.createObjectURL(file) : '',
        };
      },
      async InvokeLLM() {
        throw new Error('LLM integration is not configured in the Supabase-only build.');
      },
      async SendEmail() {
        console.info('[dataClient] Email integration placeholder called.');
        return { success: true };
      },
      async SendSMS() {
        console.info('[dataClient] SMS integration placeholder called.');
        return { success: true };
      },
      async GenerateImage() {
        throw new Error('Image generation is not configured in the Supabase-only build.');
      },
      async ExtractDataFromUploadedFile() {
        throw new Error('File extraction is not configured in the Supabase-only build.');
      },
    },
  },
  agents: {
    getWhatsAppConnectURL() {
      return '#';
    },
  },
  appLogs: {
    async logUserInApp() {
      return null;
    },
  },
};

export default dataClient;
