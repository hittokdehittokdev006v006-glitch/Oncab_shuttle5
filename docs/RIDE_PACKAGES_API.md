# Ride Packages API

The admin dashboard page is available at `/packages` (for example,
`https://oncab.in/bus-operator-dev/api2/bus/packages`). Package records are read from
`ride_packages`.

## Admin management APIs

All admin endpoints below use the `/api2` API base and require a bearer access
token. Listing and viewing require `packages.read`; create, update, status
toggle, and delete require `packages.manage`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/packages?status=all` | List packages, including inactive records. `status` can be `Active`, `Inactive`, or `all`. |
| `GET` | `/packages/:id` | Get a package by database ID or package code. |
| `POST` | `/packages` | Create a package. |
| `PUT` | `/packages/:id` | Update a package. |
| `PATCH` | `/packages/:id/toggle-status` | Switch between `Active` and `Inactive`. |
| `DELETE` | `/packages/:id` | Soft-delete a package. |

Create and update fields are `package_code`, `name`, `package_type`,
`rides_count`, `validity_days`, `price_per_ride`, `total_price`,
`original_price`, `discount_percentage`, `route_id`, `description`, `features`
(string array), `badge_text`, `is_popular`, and `status`. The allowed
`package_type` values are `single_trip`, `fixed_bundle`, `daily`, `weekly`,
`monthly`, `quarterly`, and `annual`. Set `route_id` to `null` for a package
available on all routes.

## Passenger app: browse and book a package

Passenger endpoints are public and use the `/api2` base URL. Package prices are
calculated from the database; clients must send the package ID/code, not a
client-calculated amount.

1. `GET /bus/packages?route_id=:routeId` lists active packages compatible with
   the selected route. `route_id` is optional; global packages are included.
2. `GET /bus/packages/:id` returns one package by ID or code.
3. `POST /bus/create-booking` creates a booking using the package's current
   database price. Send the required trip, passenger, stop, and date fields:

```json
{
  "trip_id": 123,
  "passenger_id": 42,
  "passenger_name": "Passenger Name",
  "passenger_mobile": "9876543210",
  "passenger_email": "passenger@example.com",
  "origin_stop_id": 10,
  "destination_stop_id": 15,
  "travel_date": "2026-11-01",
  "seat_numbers": [1],
  "total_seats": 1,
  "package_id": 1
}
```

Use either `trip_id` or `schedule_id`, and either `package_id` or
`package_code`. The response contains the booking `id`, `booking_reference`,
`final_amount`, and package price snapshot. A booking without wallet payment
remains pending payment.

## PayU payment for a package booking

After creating the booking, initialize checkout with:

`POST /api2/bus/payment/payu/initiate`

```json
{
  "booking_id": 987,
  "passenger_mobile": "9876543210"
}
```

The response's `data.action`, `data.method`, and `data.fields` are the PayU
hosted-checkout form target, method, and fields. Submit those fields to the
returned action. The amount is taken from the booking's server-calculated
`final_amount`; the client must not submit a payment amount. PayU returns to
the configured callback, which validates PayU's signature and amount, updates
the payment and booking, and confirms the booking (or creates a refund if the
seat can no longer be allocated).

The booking flow stores the package ID and immutable package-price snapshot on
the booking. It is a trip booking priced with a selected Ride Package; it does
not create a separate passenger ride-credit wallet.

## Passenger app: buy and use a prepaid ride pass

Prepaid ride passes are separate from the legacy per-trip package-pricing flow
above. Pass purchase and balance routes require a passenger bearer token; the
server derives the passenger ID from that token and does not accept a
client-selected owner.

1. `POST /api2/bus/package-purchases` with `package_id` or `package_code`
   creates a `pending_payment` purchase and snapshots the package's ride count,
   validity, route scope, and price.
2. `POST /api2/bus/payment/payu/initiate` with `package_purchase_id` returns
   the hosted PayU form fields. The signed callback marks payment as paid,
   activates the purchase, and calculates its expiry from activation time.
3. `GET /api2/bus/my-packages` lists purchases and balances.
   `GET /api2/bus/my-packages/:purchaseId` returns one balance and expiry;
   `GET /api2/bus/my-packages/:purchaseId/usage` returns its booking history.
4. Create a trip booking with `POST /api2/bus/create-booking` using
   `package_purchase_id` instead of `package_id` or `package_code`, and include
   a stable unique `idempotency_key` for the booking attempt. A package ride is
   reserved in the same database transaction as the booking. Each requested
   seat consumes one ride. Retrying with the same key returns the original
   booking without reserving additional rides.
5. Cancelling an eligible booking releases its reservation through
   `POST /api2/bus/bookings/:bookingId/cancel` or the bus/shuttle cancellation
   aliases, with the passenger bearer token. The token owner must match the
   booking owner; legacy bookings retain their existing cancellation behavior.
   Operator/admin cancellation and trip cancellation also release reservations.
   When the driver marks the trip complete, boarded rides are consumed; a
   recorded no-show also consumes the reserved ride. Reservations for cancelled
   or unboarded bookings are released at trip completion. Cancelling a trip
   through the operator trip-status API or removing its date during schedule
   regeneration cancels its pending prepaid-pass bookings and releases their
   reservations.

   Example package booking request:

   ```json
   {
     "trip_id": 123,
     "origin_stop_id": 10,
     "destination_stop_id": 15,
     "travel_date": "2026-11-01",
     "seat_numbers": [1],
     "total_seats": 1,
     "package_purchase_id": 501,
     "idempotency_key": "pass-501-trip-123-seat-1"
   }
   ```

   The authenticated passenger ID is taken from the bearer token; `passenger_id`
   is not required for this prepaid-pass request.

Balances distinguish consumed and reserved rides:

```text
available_rides = total_rides - used_rides - reserved_rides
```

For example, a 10-ride purchase with 1 consumed and 1 reserved ride reports
8 `available_rides` and `remaining_rides`, with `unconsumed_rides` equal to 9.

The purchase is not usable before PayU confirms payment, after expiry, or when
its available balance is insufficient. It becomes `exhausted` only after all
rides are consumed, not merely when all remaining rides are reserved. An
expired purchase cannot create new bookings. Expiry is calculated as the exact
number of 24-hour days after activation and is exclusive: a purchase is expired
at the recorded `expires_at` timestamp.

For backwards compatibility, `package_id`/`package_code` on the original
booking endpoints continues to use the per-trip price-snapshot behavior
described above. Use `package_purchase_id` for reusable prepaid ride credits.

## Admin purchase ledger

Users with the `packages.read` permission can review prepaid purchases in the
admin panel under **Bookings & Revenue → Package Purchases**. The list displays
the passenger, package snapshot, purchase/payment status, ride balance, amount,
and latest payment transaction ID. Open a purchase to see its full payment
transaction history and ride reservation/consumption history.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api2/package-purchases` | Paginated purchase ledger. Accepts `page`, `limit`, `search`, `status`, `payment_status`, `from_date`, and `to_date`. Search matches purchase ID, package name/code, and passenger name/mobile/email. |
| `GET` | `/api2/package-purchases/:purchaseId` | One purchase with passenger details, payment transactions, and ride usage. |

Example list query:

```http
GET /api2/package-purchases?page=1&limit=15&payment_status=paid&search=Sam
Authorization: Bearer <admin_access_token>
```

## Passenger app purchase and transaction APIs

All passenger endpoints below require the passenger access token in the
`Authorization: Bearer <passenger_access_token>` header. The app helper
`passengerPackagesAPI` in `src/frontend/src/services/api.ts` uses that token
automatically.

| Method | Endpoint | App use |
| --- | --- | --- |
| `POST` | `/api2/bus/package-purchases` | Create a pending purchase. Body: `{"package_id": 12}` or `{"package_code": "TEN-RIDES"}`. |
| `POST` | `/api2/bus/payment/payu/initiate` | Start PayU checkout. Body: `{"package_purchase_id": 501}`. |
| `GET` | `/api2/bus/my-packages` | List the passenger's purchases and current ride balances. |
| `GET` | `/api2/bus/my-packages/:purchaseId` | Read one purchase/balance. |
| `GET` | `/api2/bus/my-packages/:purchaseId/usage` | Read reservations, consumed rides, and releases. |
| `GET` | `/api2/bus/my-package-transactions?page=1&limit=20` | Paginated payment transaction history for this passenger's prepaid packages. |
| `POST` | `/api2/bus/create-booking` | Book a ride using `package_purchase_id` and a stable `idempotency_key`. |
| `GET` | `/api2/bus/bookings/:bookingId` | Read one of the passenger's bookings. |
| `POST` | `/api2/bus/bookings/:bookingId/cancel` | Cancel an eligible booking and release the reservation. |

The transaction-history endpoint returns safe payment fields (transaction IDs,
gateway/method, amount, currency, status, and timestamp) alongside a package
snapshot. It does not return raw gateway payloads or callback data. All purchase,
balance, usage, transaction, and booking reads are scoped to the authenticated
passenger.

## Shuttle API aliases

For clients already using the shuttle API namespace, these equivalent package
and checkout routes are also available:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/shuttle/packages?route_id=:routeId` | List active packages. |
| `POST` | `/shuttle/packages/list` | List active packages using a JSON body. |
| `GET` | `/shuttle/packages/:id` | Get package details. |
| `POST` | `/shuttle/book` | Create a shuttle booking; include `package_id` or `package_code` to price it as a package booking. |
| `POST` | `/shuttle/payment/payu/initiate` | Start PayU checkout for the created booking. |
| `POST` | `/shuttle/payment/payu-callback` | PayU callback alias; the configured callback defaults to `/bus/payment/payu-callback`. |

## Frontend API helpers

The operator dashboard uses `packagesAPI` for authenticated CRUD. The passenger
app can use `shuttleAPI.getAvailablePackages`, `getAvailablePackage`,
`createPackageBooking`, and `initiatePackagePayment` from
`src/frontend/src/services/api.ts`. Passenger purchase and balance helpers are
available as `passengerPackagesAPI`; they read the passenger bearer token from
`passenger_access_token` and expose purchase, balance, usage, booking, and
PayU-initiation calls.
