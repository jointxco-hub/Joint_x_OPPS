function valueOrEmpty(value) {
  return value == null ? '' : String(value);
}

function clearable(value) {
  const clean = String(value ?? '').trim();
  return clean || null;
}

export function hydrateOrderClientDefaults(client = {}) {
  return {
    client_id: client.id || '',
    client_name: valueOrEmpty(client.name),
    client_email: valueOrEmpty(client.email || client.client_email),
    client_phone: valueOrEmpty(client.phone || client.client_phone || client.whatsapp),
    whatsapp_name: valueOrEmpty(client.whatsapp_name),
    saved_contact_name: valueOrEmpty(client.saved_contact_name),
    pep_code: valueOrEmpty(client.pep_code),
    delivery_note: valueOrEmpty(client.delivery_note || client.delivery_address),
    courier: valueOrEmpty(client.preferred_courier),
    fulfillment_type: valueOrEmpty(client.fulfillment_type) || 'courier',
  };
}

export function buildClientDefaultsUpdate(form = {}) {
  return {
    name: String(form.client_name || '').trim(),
    email: clearable(form.client_email),
    phone: clearable(form.client_phone),
    whatsapp_name: clearable(form.whatsapp_name),
    saved_contact_name: clearable(form.saved_contact_name),
    pep_code: clearable(form.pep_code),
    delivery_note: clearable(form.delivery_note),
    delivery_address: clearable(form.delivery_note),
    preferred_courier: clearable(form.courier),
    fulfillment_type: form.fulfillment_type || 'courier',
  };
}
