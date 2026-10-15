# App Developer Guide: Route Stop Travel Times

This guide explains how the app reads and verifies manually configured stop-to-stop travel times. The public passenger bus endpoints do not require a bearer token. Route administration and driver app endpoints do.

## How stop timing works

`route_stops.travel_time_minutes` is the travel time **from the previous stop to this stop**, in whole minutes. The first stop's value is ignored for elapsed time (the route editor saves it as `0`). The scheduled time at a stop is:

```text
stop scheduled time = trip departure time + sum of segment minutes through that stop
```

Example: departure `08:50`, stop 1 = `0`, stop 2 = `20`, stop 3 = `30` gives stop times `08:50`, `09:10`, `09:40`. Riding from stop 2 to stop 3 takes `30` minutes. Search responses generally format calculated times as `9:10 AM`; driver route stop responses use `09:10:00`.

The calculation wraps at midnight. If a trip crosses midnight, use `trip_date` with the time to determine the following date; the current time fields themselves do not include a date offset.

## Before testing

1. Start the API (`http://localhost:4000` by default) and connect it to a non-production database.
2. Ensure the `route_stops.travel_time_minutes` column exists. The server's route stop migrator ensures it at startup; the standalone SQL migration is `migrations/route_stop_travel_time.sql`.
3. Choose an active route with an upcoming trip/schedule, a pickup stop, and a later drop-off stop.
4. Use a disposable passenger and trip if you plan to create a booking. Booking creation reserves seats and changes database state.

## Save and verify route segment minutes (admin)

Route edits replace the route's ordered stop links, so send the complete ordered stop list in the `PUT`, including IDs and segment values. Authenticate with an admin token that can manage routes.

```http
PUT {{baseUrl}}/routes/{{routeId}}
Authorization: Bearer {{adminToken}}
Content-Type: application/json
```

```json
{
  "stops": [
    { "stop_id": 549, "stop_sequence": 1, "travel_time_minutes": 0 },
    { "stop_id": 550, "stop_sequence": 2, "travel_time_minutes": 20 },
    { "stop_id": 551, "stop_sequence": 3, "travel_time_minutes": 30 }
  ]
}
```

The response is `{ "success": true, "data": { "estimated_duration": 50, "stops": [...] } }`; `data.stops[].travel_time_minutes` must match the submitted values. Then read back the route:

```http
GET {{baseUrl}}/routes/{{routeId}}
Authorization: Bearer {{adminToken}}
```

Verify the returned stop values. You can also verify persistence directly in MySQL:

```sql
SELECT rs.route_id, rs.stop_sequence, rs.stop_id, s.stop_name, rs.travel_time_minutes
FROM route_stops AS rs
JOIN stops AS s ON s.id = rs.stop_id
WHERE rs.route_id = <routeId>
ORDER BY rs.stop_sequence;
```

## Passenger route search

```http
POST {{baseUrl}}/bus/search-routes
Content-Type: application/json
```

```json
{
  "pickup": { "stop_id": 549, "name": "Stop 1" },
  "dropoff": { "stop_id": 551, "name": "Stop 3" },
  "date": "2026-10-20",
  "passengers": 1
}
```

For a matching route, inspect `routes[].trips[]` (and the backward-compatible `top_pick` / `all_timings` fields):

```json
{
  "pickup_time": "8:50 AM",
  "drop_time": "9:40 AM",
  "stop_schedule": [
    { "stop_id": 549, "arrival_time": "8:50 AM", "travel_time_minutes": 0 },
    { "stop_id": 550, "arrival_time": "9:10 AM", "travel_time_minutes": 20 },
    { "stop_id": 551, "arrival_time": "9:40 AM", "travel_time_minutes": 30 }
  ]
}
```

`duration_minutes` is the segment sum between the selected pickup and drop-off, excluding the time before pickup.

## Schedule lookup for selected stops

Pass route, pickup, and drop-off IDs together; this is the schedule lookup mode that calculates the stop-specific times.

```http
POST {{baseUrl}}/bus/schedules
Content-Type: application/json
```

```json
{
  "route_id": 12,
  "pickup_stop_id": 550,
  "drop_stop_id": 551,
  "date": "2026-10-20",
  "passengers": 1
}
```

Successful responses have `status: true` and `schedules[]` (or date-keyed schedules if `date_key: true`). Each schedule includes `pickup_time`, `drop_time`, `duration_minutes`, pickup/drop stop `arrival_time`, and a complete `stop_schedule[]`.

## Booking and passenger tracking

The public app can create a booking at `POST {{baseUrl}}/bus/create-booking`. It requires a real active `passenger_id`, matching `passenger_mobile`, a valid upcoming `trip_id` or `schedule_id`, selected stop IDs, `travel_date`, and seat details. Booking creation is state-changing; don't run it against production while testing.

Once a booking exists, fetch scheduled times and live bus information with:

```http
POST {{baseUrl}}/bus/track-booking
Content-Type: application/json
```

```json
{ "booking_id": 1234 }
```

The public response includes `data.scheduled_pickup_time`, `data.scheduled_drop_time`, and `data.route_stoppages.stops[]` with each stop's `scheduled_time` (`HH:mm:ss`). It also includes GPS-derived fields such as `bus_live_location` and `timing_and_distance.eta_minutes`. The scheduled time comes from the manual route segments; live ETA to the pickup is based on bus location and routing calculation. The authenticated admin endpoint `GET /bookings/{id}/track` returns `trip_stops[]` with each stop's `arrival_time` in 12-hour format.

Other public aliases are `GET /bus/track?booking_id=1234` and `GET /bus/bookings/1234/track`. The authenticated admin endpoint `GET /bookings/1234/track` is also available under `/api2`.

## Driver app timing endpoints

Driver login uses OTP:

```http
POST {{baseUrl}}/bus-driver/auth/login-otp
Content-Type: application/json
{ "mobile": "<registered-driver-mobile>" }
```

Verify the OTP sent by SMS (or `otp_demo` returned in non-production mode):

```http
POST {{baseUrl}}/bus-driver/auth/verify-otp
Content-Type: application/json
{ "mobile": "<registered-driver-mobile>", "otp": "<received-otp>" }
```

Use `data.token` as a bearer token for the driver endpoints below. Driver responses include manually calculated stop times in `HH:mm:ss` format:

| Request | Timing data |
| --- | --- |
| `GET /bus-driver/assigned-trips` | Each trip's `stop_schedule[]` |
| `GET /bus-driver/trips/{tripId}` | `data.route.stops[]` with `pickup_time` and `scheduled_arrival_time` |
| `GET /bus-driver/trips/{tripId}/current-stop` | Current stop's `scheduled_time` and `eta` |
| `GET /bus-driver/trips/{tripId}/route-map` | Ordered stops with `scheduled_time` |
| `GET /bus-driver/trips/{tripId}/manifest` | Each passenger's `scheduled_pickup_time` and `scheduled_drop_time` |

For example:

```http
GET {{baseUrl}}/bus-driver/trips/{{tripId}}/manifest
Authorization: Bearer {{driverToken}}
```

## Postman / CLI test flow

Import `postman/Oncab-Route-Timing.postman_collection.json`. Configure its collection variables (`baseUrl`, `adminToken`, `driverToken`, `routeId`, `pickupStopId`, `middleStopId`, `dropStopId`, `tripId`, `travelDate`, expected pickup/drop times and expected duration) for your test database. Run the requests in order. The collection checks persisted route segment values, search times, schedule times, and authenticated driver stop/manifest times. It does not create a booking.

With Postman CLI installed, run:

```sh
postman collection run postman/Oncab-Route-Timing.postman_collection.json
```

If route IDs and tokens are stored in a Postman environment instead, select that environment in Postman or add `-e <environment-file.json>` to the CLI command. Confirm the selected date has an active trip and that the route has a fare configured; route search can legitimately return no results if no matching trip/schedule or fare exists.

## Troubleshooting

- **The admin route GET still returns the old minute value:** check the `PUT` response and the SQL query above. A failed DB write should return an API error; confirm the backend is connected to the database you queried.
- **Search returns no matching trip:** confirm stop order (pickup must precede drop-off), route/schedule status, trip date, available seats, and fare configuration.
- **Schedule lookup has no results:** ensure the exact `route_id`, `pickup_stop_id`, and `drop_stop_id` belong to the route and that the requested date has a running schedule.
- **Scheduled time is present but live ETA is missing:** scheduled time is manual; live ETA also requires a current driver GPS location.
- **A driver endpoint returns 401/403:** log in through the driver OTP endpoints and use `data.token`, not an admin token.
