# WACKO NIGHT frontend (phase 1)
Static files in `public/`, to be served by Express (`express.static('public')`).

## API contract the backend must provide
- GET  /api/event -> {name,date,startTime|null,price,venue,salesOpen,ticketsRemaining|null,maxPerOrder|null,contactEmail|null}
- POST /api/checkout {name,email,phone,quantity} -> {paymentUrl}  (server computes amount; redirects back to /ticket.html?ref=REF)
- GET  /api/orders/:ref -> {status:'pending'|'paid'|'failed',eventName,eventDate,buyerName,tickets:[{code}]}
- GET  /api/tickets/:code/qr.svg
- POST /api/scan {code} -> {status:'valid'|'already_used'|'invalid',detail?}  (staff-auth, atomic check-in)
- POST /api/admin/login {password}; POST /api/admin/logout
- GET/PUT /api/admin/settings {name,date,startTime,venue,price,totalTickets,maxPerOrder,contactEmail,salesOpen}
- GET  /api/admin/stats -> {sold,remaining,checkedIn,revenue}
Confirmed details live in one place: `DEFAULTS` in `public/js/api.js` (fallback until /api/event responds).
