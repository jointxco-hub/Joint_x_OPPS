import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const secret = Deno.env.get('INTERNAL_APP_SHARED_SECRET') || '';
    if (req.headers.get('X-XLab-Secret') !== secret) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const order = await base44.asServiceRole.entities.Order.create({
      client_name: body.client_name,
      client_email: body.client_email,
      order_number: body.order_number,
      products: body.products,
      total_amount: body.total_amount,
      print_type: body.print_type,
      special_instructions: body.special_instructions,
      file_urls: body.file_urls,
      status: 'confirmed',
    });

    return Response.json({ order_id: order.id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});