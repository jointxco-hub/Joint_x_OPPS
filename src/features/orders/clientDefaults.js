import { defaultApplyShippingFeeForFulfillment } from '../../lib/orderTotal.js';

function valueOrEmpty(value) {
  return value == null ? '' : String(value);
}

function clearable(value) {
  const clean = String(value ?? '').trim();
  return clean || null;
}

// apply_shipping_fee is computed here, alongside fulfillment_type, so it
// is set exactly once at order-creation time (this function only runs
// when composing a new order's initial state) and never recomputed
// reactively if fulfillment_type is edited later - see orderTotal.js.
export function hydrateOrderClientDefaults(client = {}) {
  const fulfillmentType = valueOrEmpty(client.fulfillment_type) || 'courier';
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
    fulfillment_type: fulfillmentType,
    apply_shipping_fee: defaultApplyShippingFeeForFulfillment(fulfillmentType),
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
