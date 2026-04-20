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
        console.log("Received Order from X Lab:", JSON.stringify(payload));

        const newOrder = {
            client_name: payload.client_name,
            client_email: payload.client_email,
            client_phone: payload.client_phone,
            order_number: payload.order_number,
            products: payload.products || [],
            total_amount: payload.total_amount,
            notes: payload.notes,
            special_instructions: payload.special_instructions,
            file_urls: payload.design_files || [],
            print_type: payload.print_type || "none",
            status: "confirmed"
        };

        const created = await base44.asServiceRole.entities.Order.create(newOrder);
        console.log("Order created:", created.id);

        return Response.json({ message: "Order received.", orderId: created.id }, { status: 200 });
    } catch (error) {
        console.error("Error:", error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});