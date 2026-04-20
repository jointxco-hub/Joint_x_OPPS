import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const secret = Deno.env.get('INTERNAL_APP_SHARED_SECRET') || '';
    if (req.headers.get('X-XLab-Secret') !== secret) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const payment = await base44.asServiceRole.entities.Payment.create({
      order_id: body.order_id,
      order_number: body.order_number,
      client_name: body.client_name,
      amount: body.amount,
      method: body.method || 'eft',
      status: body.status || 'completed',
      notes: body.reference,
    });

    return Response.json({ payment_id: payment.id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});