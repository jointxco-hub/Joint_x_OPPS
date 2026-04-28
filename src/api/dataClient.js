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

const ENTITY_CONFIG = {
  Client: {
    table: 'clients',
    sortMap: {
      created_date: 'created_at',
      updated_date: 'updated_at',
      client_name: 'name',
      client_email: 'email',
    },
    filterMap: {
      created_date: 'created_at',
      updated_date: 'updated_at',
      client_name: 'name',
      client_email: 'email',
    },
    normalize(row) {
      return {
        ...row,
        client_name: row.name,
        client_email: row.email,
        client_phone: row.phone,
        created_date: row.created_at,
        updated_date: row.updated_at,
      };
    },
    serialize(payload) {
      return compactObject({
        name: payload.name ?? payload.client_name,
        email: payload.email ?? payload.client_email,
        phone: payload.phone ?? payload.client_phone,
        company_name: payload.company_name,
        notes: payload.notes,
        is_archived: payload.is_archived,
        archived_at: payload.archived_at,
      });
    },
  },
  Project: {
    table: 'projects',
    sortMap: {
      created_date: 'created_at',
      updated_date: 'updated_at',
      client_name: 'client_id',
    },
    filterMap: {
      created_date: 'created_at',
      updated_date: 'updated_at',
      client_name: 'client_id',
      is_archived: 'is_archived',
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
        description: payload.description,
        status: payload.status,
        client_id: payload.client_id,
        start_date: payload.start_date,
        due_date: payload.due_date,
        notes: payload.notes,
        is_archived: payload.is_archived,
        archived_at: payload.archived_at,
      });
    },
  },
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
  OpsTask: {
    table: 'ops_tasks',
    sortMap: {
      created_date: 'created_at',
      updated_date: 'updated_at',
      due_date: 'deadline',
      deadline: 'deadline',
    },
    filterMap: {
      created_date: 'created_at',
      updated_date: 'updated_at',
      due_date: 'deadline',
      week_number: 'week_number',
      status: 'status',
    },
    normalize(row) {
      return {
        ...row,
        due_date: row.deadline,
        created_date: row.created_at,
        updated_date: row.updated_at,
      };
    },
    serialize(payload) {
      const cleanId = (v) => (v && v !== '_none' ? v : undefined);
      return compactObject({
        title: payload.title,
        description: payload.description || undefined,
        production_type: payload.production_type || undefined,
        production_stage: payload.production_stage || undefined,
        status: payload.status,
        priority: payload.priority,
        start_date: payload.start_date || undefined,
        deadline: payload.deadline || payload.due_date || undefined,
        week_number: numberOrUndefined(payload.week_number),
        day_of_week: payload.day_of_week || undefined,
        assigned_to: Array.isArray(payload.assigned_to) ? payload.assigned_to : [],
        client_id: cleanId(payload.client_id),
        client_name: payload.client_name || undefined,
        order_id: cleanId(payload.order_id),
        project_id: cleanId(payload.project_id),
        alethea_project_id: cleanId(payload.alethea_project_id),
        deliverables: payload.deliverables || undefined,
        notes: payload.notes || undefined,
        supporting_files: payload.supporting_files ?? [],
        subtasks: payload.subtasks ?? [],
        comments: payload.comments ?? [],
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
  Supplier: {
    table: 'suppliers',
    sortMap: {
      created_date: 'created_at',
      updated_date: 'updated_at',
      vendor: 'name',
    },
    filterMap: {
      created_date: 'created_at',
      updated_date: 'updated_at',
      vendor: 'name',
    },
    normalize(row) {
      return {
        ...row,
        vendor: row.name,
        created_date: row.created_at,
        updated_date: row.updated_at,
      };
    },
    serialize(payload) {
      return compactObject({
        name: payload.name ?? payload.vendor,
        contact_person: payload.contact_person,
        email: payload.email,
        phone: payload.phone,
        category: payload.category,
        notes: payload.notes,
        is_archived: payload.is_archived,
        archived_at: payload.archived_at,
      });
    },
  },
  PurchaseOrder: {
    table: 'purchase_orders',
    sortMap: {
      created_date: 'created_at',
      updated_date: 'updated_at',
      archived_at: 'archived_at',
      due_date: 'expected_date',
    },
    filterMap: {
      created_date: 'created_at',
      updated_date: 'updated_at',
      archived_at: 'archived_at',
      order_id: 'linked_order_id',
      supplier_id: 'supplier_id',
      project_id: 'project_id',
      is_archived: 'is_archived',
    },
    normalize(row) {
      return {
        ...row,
        order_id: row.linked_order_id,
        due_date: row.expected_date,
        created_date: row.created_at,
        updated_date: row.updated_at,
      };
    },
    serialize(payload) {
      return compactObject({
        po_number: payload.po_number,
        supplier_id: payload.supplier_id,
        project_id: payload.project_id,
        linked_order_id: payload.linked_order_id ?? payload.order_id,
        status: payload.status,
        items: payload.items,
        notes: payload.notes,
        total_amount: numberOrUndefined(payload.total_amount),
        expected_date: payload.expected_date ?? payload.due_date,
        received_date: payload.received_date,
        is_archived: payload.is_archived,
        archived_at: payload.archived_at,
      });
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
        status: row.payment_status,
        method: row.payment_method,
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
  if (!warnedEntities.has(entityName)) {
    warnedEntities.add(entityName);
    console.warn(
      `[dataClient] ${entityName} is not in the current Supabase Phase 1 schema. Using local fallback only.`
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
      if (isSupported) {
        const rows = await runSelect(entityName, {}, sort, limit);
        if (rows) {
          return rows;
        }
      }

      return handleLocalEntity(entityName, 'list', sort, limit);
    },

    async filter(filter = {}, sort, limit = 100) {
      if (isSupported) {
        const rows = await runSelect(entityName, filter, sort, limit);
        if (rows) {
          return rows;
        }
      }

      return handleLocalEntity(entityName, 'filter', filter, sort, limit);
    },

   async create(payload = {}) {
  if (isSupported) {
    const row = await runInsert(entityName, payload);
    if (row) {
      return row;
    }
    if (supabase) {
      throw new Error(`[dataClient] ${entityName} failed to save. Check console for details.`);
    }
  }
  return handleLocalEntity(entityName, 'create', payload);
},

    async update(id, payload = {}) {
  if (isSupported) {
    const row = await runUpdate(entityName, id, payload);
    if (row) {
      return row;
    }
    if (supabase) {
      throw new Error(`[dataClient] ${entityName} update failed. Check console for details.`);
    }
  }
  return handleLocalEntity(entityName, 'update', id, payload);
},
    async delete(id) {
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
