import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const sharedSecret = Deno.env.get("INTERNAL_APP_SHARED_SECRET");
        const incomingSecret = req.headers.get("X-Shared-Secret");

        if (!sharedSecret || incomingSecret !== sharedSecret) {
            return Response.json({ error: "Unauthorized" }, { status: 403 });
        }

        const payload = await req.json();
        console.log("Received Payment from X Lab:", JSON.stringify(payload));

        const newPayment = {
            order_id: payload.order_id,
            order_number: payload.order_number,
            client_name: payload.client_name,
            amount: payload.amount,
            method: payload.method || "eft",
            status: payload.status || "completed",
            payment_date: payload.payment_date || new Date().toISOString().split('T')[0],
            invoice_number: payload.invoice_number,
        };

        const created = await base44.asServiceRole.entities.Payment.create(newPayment);
        console.log("Payment created:", created.id);

        return Response.json({ message: "Payment received.", paymentId: created.id }, { status: 200 });
    } catch (error) {
        console.error("Error:", error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});