# Oncab Ride Packages (Prepaid Ride Passes) - Mobile App API Documentation

Complete API specification for the passenger mobile app (Android / iOS / Web).
All endpoints use the base URL:
`https://oncab.in/bus-operator-dev/api2/bus` (or `/api2/shuttle` alias)

---

## 📌 Complete App Integration Architecture & Flow

```
1. BROWSE PACKAGES ──▶ GET /packages?route_id=X
       │
       ▼
2. BUY PACKAGE      ──▶ POST /package-purchases (Auth: Bearer Token)
       │               Returns: purchase_id (status: pending_payment)
       ▼
3. PAY VIA PAYU     ──▶ POST /payment/payu/initiate (package_purchase_id)
       │               Returns: PayU action URL & form fields (hash, txnid)
       │               App renders PayU Checkout
       ▼
4. ACTIVATION       ──▶ PayU Webhook / Callback marks payment "paid" & status "active"
       │               Package is now loaded with rides and valid until expires_at
       ▼
5. CHECK BALANCE    ──▶ GET /my-packages (Shows available_rides, expires_at)
       │
       ▼
6. BOOK A TRIP      ──▶ POST /create-booking with package_purchase_id & idempotency_key
       │               Reserves ride (available_rides decremented by total_seats)
       │               Booking is confirmed with ₹0 additional payment
       ▼
7. LIFECYCLE:
   - If Passenger CANCELS: POST /bookings/:id/cancel ──▶ Ride reservation RELEASED back to pass.
   - When Driver COMPLETES TRIP: Boarded rides marked CONSUMED; pass balance permanently updated.
```

---

## 🔑 Authentication Headers

All passenger package purchase, balance, booking, and cancellation endpoints require the Passenger JWT Access Token:

```http
Authorization: Bearer <passenger_access_token>
Content-Type: application/json
```

---

## 1. Browse Available Ride Packages

Fetches active packages available for purchase. Optionally filtered by route. Global packages (`route_id = null`) apply to all routes.

- **Method**: `GET` (or `POST`)
- **URL**: `https://oncab.in/bus-operator-dev/api2/bus/packages`
- **Auth**: Public (None required)
- **Query Parameters**:
  - `route_id` *(optional, integer)*: ID of the selected route to show route-specific + global packages.

### Request Example
```http
GET https://oncab.in/bus-operator-dev/api2/bus/packages?route_id=5
Accept: application/json
```

### Success Response (`200 OK`)
```json
{
  "status": 200,
  "success": true,
  "message": "Ride Pack packages retrieved successfully",
  "data": [
    {
      "id": 1,
      "package_code": "TEN-RIDES-PASS",
      "name": "10 Rides Smart Pass",
      "package_type": "fixed_bundle",
      "rides_count": 10,
      "validity_days": 30,
      "price_per_ride": 70.00,
      "total_price": 700.00,
      "original_price": 900.00,
      "savings_amount": 200.00,
      "discount_percentage": 22,
      "formatted_price": "₹700",
      "formatted_per_ride": "₹70/ride",
      "route_id": null,
      "description": "Save ₹200 on daily commute across any route. Valid for 30 days.",
      "features": [
        "10 Trips on any route",
        "Valid for 30 days from purchase",
        "Free cancellation up to 30 mins before trip",
        "Priority seat confirmation"
      ],
      "badge_text": "BESTSELLER",
      "is_popular": true,
      "status": "Active"
    },
    {
      "id": 2,
      "package_code": "MONTHLY-PASS-40",
      "name": "Monthly Commuter Pass",
      "package_type": "monthly",
      "rides_count": 40,
      "validity_days": 35,
      "price_per_ride": 55.00,
      "total_price": 2200.00,
      "original_price": 3600.00,
      "savings_amount": 1400.00,
      "discount_percentage": 39,
      "formatted_price": "₹2200",
      "formatted_per_ride": "₹55/ride",
      "route_id": 5,
      "description": "Unlimited commute between Salt Lake and Howrah for 35 days.",
      "features": [
        "40 Rides on Route #5",
        "Valid for 35 days",
        "Guaranteed window seats",
        "Maximum savings"
      ],
      "badge_text": "SUPER SAVER",
      "is_popular": false,
      "status": "Active"
    }
  ]
}
```

---

## 2. Get Single Package Details

Fetches full pricing, validity, features, and route restrictions of a specific package by database ID or unique package code.

- **Method**: `GET`
- **URL**: `https://oncab.in/bus-operator-dev/api2/bus/packages/:id`
- **Path Parameter**: `:id` — Database package ID (e.g. `1`) or code (`TEN-RIDES-PASS`)
- **Auth**: Public

### Request Example
```http
GET https://oncab.in/bus-operator-dev/api2/bus/packages/TEN-RIDES-PASS
```

### Success Response (`200 OK`)
```json
{
  "status": 200,
  "success": true,
  "message": "Package details retrieved successfully",
  "data": {
    "id": 1,
    "package_code": "TEN-RIDES-PASS",
    "name": "10 Rides Smart Pass",
    "package_type": "fixed_bundle",
    "rides_count": 10,
    "validity_days": 30,
    "price_per_ride": 70.00,
    "total_price": 700.00,
    "original_price": 900.00,
    "savings_amount": 200.00,
    "discount_percentage": 22,
    "route_id": null,
    "description": "Save ₹200 on daily commute across any route. Valid for 30 days.",
    "features": [
      "10 Trips on any route",
      "Valid for 30 days from purchase",
      "Free cancellation"
    ],
    "badge_text": "BESTSELLER",
    "is_popular": true,
    "status": "Active"
  }
}
```

---

## 3. Create Package Purchase (Order Pending Pass)

Initiates a purchase for a package. The server creates a snapshot of the package (price, rides count, validity days, route scope) and generates a record in status `pending_payment`.

- **Method**: `POST`
- **URL**: `https://oncab.in/bus-operator-dev/api2/bus/package-purchases`
- **Auth**: `Bearer <passenger_access_token>` (Required)

### Request Body
```json
{
  "package_id": 1
}
```
*(Or use `"package_code": "TEN-RIDES-PASS"`)*

### Success Response (`201 Created`)
```json
{
  "success": true,
  "message": "Package purchase created. Complete PayU checkout to activate it.",
  "data": {
    "id": 501,
    "passenger_id": 42,
    "package_id": 1,
    "route_id": null,
    "package_code": "TEN-RIDES-PASS",
    "package_name": "10 Rides Smart Pass",
    "total_rides": 10,
    "used_rides": 0,
    "reserved_rides": 0,
    "available_rides": 10,
    "remaining_rides": 10,
    "unconsumed_rides": 10,
    "validity_days": 30,
    "price_per_ride": 70.00,
    "amount_paid": 700.00,
    "payment_status": "pending",
    "status": "pending_payment",
    "activated_at": null,
    "expires_at": null,
    "created_at": "2026-10-26T15:00:00.000Z",
    "updated_at": "2026-10-26T15:00:00.000Z"
  }
}
```

### Error Responses
- `400 Bad Request`: `{"success": false, "message": "package_id or package_code is required"}`
- `401 Unauthorized`: `{"success": false, "message": "Passenger authentication required"}`
- `404 Not Found`: `{"success": false, "message": "Active package was not found"}`

---

## 4. Initiate PayU Checkout for Package Purchase

Generates the PayU hosted checkout form fields, signed transaction ID, and cryptographic SHA-512 payment hash.

- **Method**: `POST`
- **URL**: `https://oncab.in/bus-operator-dev/api2/bus/payment/payu/initiate`
- **Auth**: `Bearer <passenger_access_token>` (Required)

### Request Body
```json
{
  "package_purchase_id": 501
}
```

### Success Response (`200 OK`)
```json
{
  "success": true,
  "message": "PayU checkout initialized",
  "data": {
    "action": "https://secure.payu.in/_payment",
    "method": "POST",
    "fields": {
      "key": "mQGxxxx",
      "txnid": "OC179300520012345",
      "amount": "700.00",
      "productinfo": "Ride Package TEN-RIDES-PASS",
      "firstname": "Rahul Sharma",
      "email": "rahul.sharma@example.com",
      "phone": "9876543210",
      "surl": "https://oncab.in/bus-operator-dev/api2/bus/payment/payu-callback",
      "furl": "https://oncab.in/bus-operator-dev/api2/bus/payment/payu-callback",
      "udf1": "package_purchase:501",
      "udf2": "",
      "udf3": "",
      "udf4": "",
      "udf5": "",
      "hash": "b2e5a78f14c0a59928bc3a67d025e791244e8bc1a37c569..."
    }
  }
}
```

### App Handling Logic:
1. Open a mobile WebView or post the form to `data.action` with `data.fields`.
2. PayU redirects the user to complete payment (Cards, UPI, NetBanking).
3. PayU calls the signed callback (`surl`). The backend verifies the cryptographic hash, marks `payment_status = "paid"`, activates the purchase:
   - `status = "active"`
   - `activated_at = NOW()`
   - `expires_at = NOW() + (validity_days * 24 hours)`
4. The pass is now active and immediately usable for booking trips!

---

## 5. List Passenger's Packages & Ride Balances

Fetches all packages purchased by the logged-in passenger along with real-time ride balances and expiry status.

- **Method**: `GET`
- **URL**: `https://oncab.in/bus-operator-dev/api2/bus/my-packages`
- **Auth**: `Bearer <passenger_access_token>` (Required)

### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": [
    {
      "id": 501,
      "passenger_id": 42,
      "package_id": 1,
      "package_code": "TEN-RIDES-PASS",
      "package_name": "10 Rides Smart Pass",
      "route_id": null,
      "total_rides": 10,
      "used_rides": 2,
      "reserved_rides": 1,
      "available_rides": 7,
      "remaining_rides": 7,
      "unconsumed_rides": 8,
      "validity_days": 30,
      "price_per_ride": 70.00,
      "amount_paid": 700.00,
      "payment_status": "paid",
      "status": "active",
      "activated_at": "2026-10-26T15:05:00.000Z",
      "expires_at": "2026-11-25T15:05:00.000Z",
      "created_at": "2026-10-26T15:00:00.000Z"
    }
  ]
}
```

### Ride Balance Arithmetic:
- `available_rides` = `total_rides - used_rides - reserved_rides` *(Rides that can be booked right now)*
- `unconsumed_rides` = `total_rides - used_rides`
- `status`:
  - `pending_payment`: Awaiting PayU confirmation.
  - `active`: Usable.
  - `exhausted`: All rides consumed (`used_rides == total_rides`).
  - `expired`: Current timestamp exceeds `expires_at`.

---

## 6. Get Single Purchased Package & Balance

Fetches status, remaining rides, and expiry for a single pass.

- **Method**: `GET`
- **URL**: `https://oncab.in/bus-operator-dev/api2/bus/my-packages/:purchaseId`
- **Path Parameter**: `:purchaseId` — e.g. `501`
- **Auth**: `Bearer <passenger_access_token>` (Required)

### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "id": 501,
    "package_name": "10 Rides Smart Pass",
    "package_code": "TEN-RIDES-PASS",
    "total_rides": 10,
    "used_rides": 2,
    "reserved_rides": 1,
    "available_rides": 7,
    "remaining_rides": 7,
    "status": "active",
    "expires_at": "2026-11-25T15:05:00.000Z"
  }
}
```

---

## 7. Get Ride Usage History of a Pass

Returns every trip reservation, boarded ride, and cancelled/released ride linked to this pass.

- **Method**: `GET`
- **URL**: `https://oncab.in/bus-operator-dev/api2/bus/my-packages/:purchaseId/usage`
- **Auth**: `Bearer <passenger_access_token>` (Required)

### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": [
    {
      "id": 102,
      "purchase_id": 501,
      "booking_id": 987,
      "rides_reserved": 1,
      "rides_consumed": 0,
      "status": "reserved",
      "reserved_at": "2026-10-26T16:00:00.000Z",
      "consumed_at": null,
      "released_at": null,
      "booking": {
        "id": 987,
        "booking_reference": "BK-261026-0987",
        "travel_date": "2026-10-27",
        "booking_status": "confirmed"
      }
    },
    {
      "id": 101,
      "purchase_id": 501,
      "booking_id": 950,
      "rides_reserved": 1,
      "rides_consumed": 1,
      "status": "consumed",
      "reserved_at": "2026-10-25T10:00:00.000Z",
      "consumed_at": "2026-10-25T18:45:00.000Z",
      "released_at": null,
      "booking": {
        "id": 950,
        "booking_reference": "BK-251025-0950",
        "travel_date": "2026-10-25",
        "booking_status": "completed"
      }
    }
  ]
}
```

---

## 8. List Payment Transactions for Packages

Returns paginated payment gateway transactions for prepaid package orders.

- **Method**: `GET`
- **URL**: `https://oncab.in/bus-operator-dev/api2/bus/my-package-transactions?page=1&limit=20`
- **Auth**: `Bearer <passenger_access_token>` (Required)

### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": [
    {
      "id": 340,
      "package_purchase_id": 501,
      "payu_txnid": "OC179300520012345",
      "payu_mihpayid": "403993715530123456",
      "payment_gateway": "payu",
      "payment_method": "UPI",
      "amount": "700.00",
      "currency": "INR",
      "status": "success",
      "created_at": "2026-10-26T15:04:12.000Z",
      "package_purchase": {
        "id": 501,
        "package_name": "10 Rides Smart Pass",
        "package_code": "TEN-RIDES-PASS",
        "total_rides": 10,
        "validity_days": 30,
        "status": "active"
      }
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 20,
    "pages": 1
  }
}
```

---

## 9. Book a Seat / Ride Using a Package Pass

Redeems rides from a purchased pass to book a seat on a scheduled trip. The booking is confirmed immediately with ₹0 additional charge.

- **Method**: `POST`
- **URL**: `https://oncab.in/bus-operator-dev/api2/bus/create-booking`
- **Auth**: `Bearer <passenger_access_token>` (Required)

### Request Body
```json
{
  "trip_id": 123,
  "origin_stop_id": 10,
  "destination_stop_id": 15,
  "travel_date": "2026-11-01",
  "seat_numbers": ["12"],
  "total_seats": 1,
  "package_purchase_id": 501,
  "idempotency_key": "pass-501-trip-123-seat-12-uuid1"
}
```

### Important Fields:
- `package_purchase_id` *(required)*: ID of the active purchased pass.
- `idempotency_key` *(required)*: A unique client-generated string (up to 100 chars, e.g. UUID). If network drops and the app retries, the server safely returns the already-created booking without deducting duplicate rides.
- `total_seats` *(required)*: Number of seats. Each seat consumes 1 ride from the pass balance.

### Success Response (`200 OK` / `201 Created`)
```json
{
  "status": 200,
  "success": true,
  "message": "Booking created successfully",
  "data": {
    "booking_id": 987,
    "booking_reference": "BK-261101-0987",
    "passenger_id": 42,
    "trip_id": 123,
    "travel_date": "2026-11-01",
    "origin_stop_id": 10,
    "destination_stop_id": 15,
    "seat_numbers": ["12"],
    "total_seats": 1,
    "booking_status": "confirmed",
    "payment_status": "paid",
    "payment_method": "package",
    "package_purchase_id": 501,
    "final_amount": 0,
    "package_snapshot": {
      "package_id": 1,
      "package_code": "TEN-RIDES-PASS",
      "package_name": "10 Rides Smart Pass",
      "rides_count": 10,
      "validity_days": 30,
      "price_per_ride": 70.00,
      "final_booking_amount": 0
    }
  }
}
```

### Error Responses
- `400 Bad Request`: `{"success": false, "message": "A unique idempotency_key is required for package bookings"}`
- `400 Bad Request`: `{"success": false, "message": "Passenger package purchase is not valid for this route"}`
- `409 Conflict`: `{"status": 409, "success": false, "message": "Passenger package purchase does not have enough rides available", "data": {"available_rides": 0, "requested_rides": 1}}`
- `409 Conflict`: `{"status": 409, "success": false, "message": "Passenger package purchase has expired"}`

---

## 10. Cancel Booking & Restore Reserved Rides

Cancelling a package booking automatically releases the reserved rides back to the passenger's pass balance.

- **Method**: `POST`
- **URL**: `https://oncab.in/bus-operator-dev/api2/bus/bookings/:bookingId/cancel`
  *(or `POST https://oncab.in/bus-operator-dev/api2/bus/cancel-booking` with `{"booking_id": 987}`)*
- **Auth**: `Bearer <passenger_access_token>` (Required)

### Request Body
```json
{
  "cancellation_reason": "Change of travel plans"
}
```

### Success Response (`200 OK`)
```json
{
  "status": 200,
  "success": true,
  "message": "Booking cancelled successfully. Reserved package ride has been restored to your pass.",
  "data": {
    "booking_id": 987,
    "booking_status": "cancelled",
    "package_purchase_id": 501,
    "rides_restored": 1
  }
}
```

---

## 📊 Summary Table of Mobile App Endpoints

| Action | Method | Endpoint URL | Auth Header |
| :--- | :---: | :--- | :--- |
| **Browse Packages** | `GET` | `/api2/bus/packages?route_id=:id` | None (Public) |
| **Package Details** | `GET` | `/api2/bus/packages/:id` | None (Public) |
| **Buy / Order Package** | `POST` | `/api2/bus/package-purchases` | `Bearer <token>` |
| **Initiate PayU Checkout** | `POST` | `/api2/bus/payment/payu/initiate` | `Bearer <token>` |
| **List My Passes & Balance** | `GET` | `/api2/bus/my-packages` | `Bearer <token>` |
| **Get Single Pass Balance** | `GET` | `/api2/bus/my-packages/:purchaseId` | `Bearer <token>` |
| **Pass Ride Usage History** | `GET` | `/api2/bus/my-packages/:purchaseId/usage` | `Bearer <token>` |
| **Pass Payment History** | `GET` | `/api2/bus/my-package-transactions` | `Bearer <token>` |
| **Book Seat with Pass** | `POST` | `/api2/bus/create-booking` | `Bearer <token>` |
| **Cancel Booking & Restore Ride** | `POST` | `/api2/bus/bookings/:bookingId/cancel` | `Bearer <token>` |

---

## 🛡️ Critical Business Rules & Logic

1. **Idempotency Key**:
   - Always supply a unique `idempotency_key` (UUID v4) when calling `/bus/create-booking` with `package_purchase_id`.
   - If the request times out or disconnects, re-submitting with the same key returns the existing booking without double-debiting rides.

2. **Route Restrictions**:
   - If a package has `route_id = null`, it can be used on **any** bus route.
   - If `route_id = 5`, it is restricted to Route #5 only. Attempting to book on Route #6 returns `400 Bad Request`.

3. **Multi-Seat Bookings**:
   - Booking `total_seats: 2` requires and reserves **2 rides** from the pass.
   - If the pass only has 1 ride left, the API returns `409 Conflict` (`available_rides: 1, requested_rides: 2`).

4. **Trip Completion & No-Shows**:
   - When the bus driver completes the trip in the driver app, passenger bookings marked as `boarded` or `no_show` are finalized, and the reserved rides transition permanently to `consumed`.
   - If a trip is cancelled by the operator/admin, all pending pass reservations for that trip are automatically restored.
