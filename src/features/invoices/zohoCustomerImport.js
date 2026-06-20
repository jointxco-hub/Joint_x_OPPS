const FIELD_ALIASES = {
  customer_name: ["customer name", "display name", "contact name", "name"],
  company_name: ["company name", "company"],
  email: ["email", "email address"],
  phone: ["phone", "phone number", "mobile", "mobile number"],
  billing_address: ["billing address", "billing street", "address"],
};

function normalize(value) {
  return String(value || "").trim();
}

function lookupKey(value) {
  return normalize(value).toLowerCase();
}

function readCsvRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value.replace(/\r$/, ""));
      if (row.some((cell) => normalize(cell))) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  row.push(value.replace(/\r$/, ""));
  if (row.some((cell) => normalize(cell))) rows.push(row);
  return rows;
}

function sourceValue(record, field) {
  const aliases = FIELD_ALIASES[field];
  const header = Object.keys(record).find((key) => aliases.includes(lookupKey(key)));
  return header ? normalize(record[header]) : "";
}

function indexClients(clients) {
  const byEmail = new Map();
  const byName = new Map();

  clients.filter((client) => !client.is_archived).forEach((client) => {
    const email = lookupKey(client.email || client.client_email);
    const name = lookupKey(client.name || client.client_name);
    if (email) byEmail.set(email, [...(byEmail.get(email) || []), client]);
    if (name) byName.set(name, [...(byName.get(name) || []), client]);
  });

  return { byEmail, byName };
}

function matchClient(customer, indexes) {
  const emailMatches = customer.email ? indexes.byEmail.get(lookupKey(customer.email)) || [] : [];
  if (emailMatches.length === 1) return emailMatches[0];

  const nameMatches = customer.customer_name ? indexes.byName.get(lookupKey(customer.customer_name)) || [] : [];
  return nameMatches.length === 1 ? nameMatches[0] : null;
}

function clientPayload(customer) {
  return {
    name: customer.customer_name,
    company_name: customer.company_name || undefined,
    email: customer.email || undefined,
    phone: customer.phone || undefined,
    delivery_address: customer.billing_address || undefined,
  };
}

export function buildZohoCustomerImportPreview(csvText, existingClients = []) {
  const rows = readCsvRows(String(csvText || "").replace(/^\uFEFF/, ""));
  if (rows.length < 2) return { headers: rows[0] || [], rows: [], invalidCount: 0 };

  const headers = rows[0].map(normalize);
  const indexes = indexClients(existingClients);
  const seen = new Set();
  let invalidCount = 0;
  const previewRows = rows.slice(1).map((cells, index) => {
    const record = Object.fromEntries(headers.map((header, column) => [header, cells[column] || ""]));
    const customer = Object.fromEntries(Object.keys(FIELD_ALIASES).map((field) => [field, sourceValue(record, field)]));
    customer.customer_name ||= customer.company_name;
    const fileKey = `${lookupKey(customer.email)}|${lookupKey(customer.customer_name)}`;
    const hasIdentity = Boolean(customer.customer_name || customer.email);
    const duplicate = hasIdentity && seen.has(fileKey);
    if (hasIdentity) seen.add(fileKey);

    if (!customer.customer_name || duplicate) invalidCount += 1;
    const client = customer.customer_name && !duplicate ? matchClient(customer, indexes) : null;
    return {
      rowNumber: index + 2,
      customer,
      client,
      payload: clientPayload(customer),
      action: !customer.customer_name ? "skip" : duplicate ? "skip" : client ? "update" : "create",
      reason: !customer.customer_name ? "Missing customer name" : duplicate ? "Duplicate row in file" : client ? "Matched existing client" : "New client",
    };
  });

  return { headers, rows: previewRows, invalidCount };
}

export function importableCustomerRows(preview) {
  return (preview?.rows || []).filter((row) => row.action === "create" || row.action === "update");
}
