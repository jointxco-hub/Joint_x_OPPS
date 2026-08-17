// Client-safe request status presentation.
//
// Real values observed directly in production: client_quote_requests.status
// is 'new' | 'reviewing' | 'actioned' (client_messages is 'new' only so
// far). client_profile_requests currently has no rows; its RPC-side
// default is 'pending_review', included below for when that changes.
// DB enums are not touched - this is presentation only.

const STATUS_LABELS = {
  new: 'Submitted',
  pending_review: 'Submitted',
  reviewing: 'In Review',
  actioned: 'Actioned',
  closed: 'Closed',
};

export function getClientSafeRequestStatus(status) {
  return STATUS_LABELS[status] ?? 'Submitted';
}

export const REQUEST_TYPE_LABELS = {
  quote_request: 'Quote request',
  reorder_request: 'Reorder request',
  message: 'Message',
  profile_update: 'Profile update',
};

export function getRequestTypeLabel(requestType) {
  return REQUEST_TYPE_LABELS[requestType] ?? 'Request';
}
