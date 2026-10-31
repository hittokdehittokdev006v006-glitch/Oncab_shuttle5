# Bus Boarding Verification System - Node.js API Documentation

## Overview

This document describes the complete boarding verification flow using QR code and PIN verification for bus bookings in the Node.js implementation.

## Architecture Flow

```
DRIVER LOGIN
      ↓
DRIVER HOME (/api2/bus-driver/home)
      ↓
TODAY'S ASSIGNED TRIP & ROUTE STOPS
      ↓
START TRIP (/api2/bus-driver/trips/:id/start)
      ↓
NAVIGATE TO CURRENT STOP (/api2/bus-driver/trips/:id/current-stop)
      ↓
ARRIVE AT STOP (/api2/bus-driver/trips/:id/stops/:stopId/arrive)
      ↓
GET STOP PASSENGER LIST (/api2/bus-driver/trips/:id/stops/:stopId/passengers)
      ↓
DRIVER SCANS PASSENGER QR (/api2/bus-driver/scan-boarding-pass)
  [Validates: Correct Trip + Correct Stop + Unboarded Status]
      ↓
PASSENGER REVEALS PIN → DRIVER ENTERS PIN (/api2/bus-driver/confirm-boarding)
      ↓
PASSENGER MARKED "BOARDED" (or MARKED NO-SHOW AT STOP)
      ↓
COMPLETE STOP (/api2/bus-driver/trips/:id/stops/:stopId/complete)
      ↓
NAVIGATE TO NEXT STOP ... REPEAT UNTIL FINAL DROP
      ↓
COMPLETE TRIP (/api2/bus-driver/trips/:id/complete)
```

---

## Database Schema

### bookings table (existing fields)

| Column | Type | Description |
|--------|------|-------------|
| `id` | INT UNSIGNED | Primary Key |
| `booking_reference` | VARCHAR(30) | Unique booking reference |
| `trip_id` | INT UNSIGNED | Trip ID |
| `passenger_id` | INT UNSIGNED | Passenger ID |
| `origin_stop_id` | INT UNSIGNED | Origin stop ID |
| `destination_stop_id` | INT UNSIGNED | Destination stop ID |
| `travel_date` | DATEONLY | Travel date |
| `seat_numbers` | JSON | Array of seat numbers |
| `total_seats` | INT | Total seats booked |
| `passenger_name` | VARCHAR(100) | Passenger name |
| `passenger_mobile` | VARCHAR(20) | Passenger mobile |
| `passenger_email` | VARCHAR(150) | Passenger email |
| `total_fare` | DECIMAL(10,2) | Total fare |
| `discount_amount` | DECIMAL(10,2) | Discount amount |
| `final_amount` | DECIMAL(10,2) | Final amount |
| `payment_status` | ENUM | 'pending', 'paid', 'failed', 'refunded', 'partial_refund' |
| `payment_method` | VARCHAR(50) | Payment method |
| `transaction_id` | VARCHAR(100) | Transaction ID |
| `booking_status` | ENUM | 'confirmed', 'cancelled', 'completed', 'pending' |
| `boarding_pass_code` | VARCHAR(20) | QR code value (BP-XXXXXXXX) |
| `boarding_pin` | VARCHAR(10) | 4-digit PIN for verification |
| `boarding_time` | TIME | When driver confirmed boarding |
| `boarded_at` | DATE | Actual boarding timestamp |
| `boarding_status` | ENUM | 'not_boarded', 'boarded', 'no_show' |
| `qr_token` | VARCHAR(255) | QR token UUID |
| `coupon_id` | INT UNSIGNED | Coupon ID |
| `special_requests` | TEXT | Special requests |
| `cancellation_reason` | TEXT | Cancellation reason |
| `cancelled_at` | DATE | Cancellation timestamp |
| `cancelled_by` | INT UNSIGNED | Cancelled by user ID |
| `status` | ENUM | 'Active', 'Cancelled', 'Completed', 'Payment Failed' |
| `deleted_at` | DATE | Soft delete timestamp |
| `created_at` | DATE | Created timestamp |
| `updated_at` | DATE | Updated timestamp |

---

## API Endpoints

### Total APIs: 33

**User-Facing (Public APIs - No Auth Required):**
1. POST `/api2/bus/types` - Get bus types
2. POST `/api2/bus/routes` - Get routes
3. POST `/api2/bus/search-routes` - Search routes with filters
4. POST `/api2/bus/schedules` - Get schedules
5. POST `/api2/bus/seat-availability` - Check seat availability
6. POST `/api2/bus/calculate-fare` - Calculate fare
7. POST `/api2/bus/user-bookings` - Get user bookings
8. POST `/api2/bus/booking-details` - Get booking details for boarding pass
9. POST `/api2/bus/cancel-booking` - Cancel user booking

**Admin-Facing (10):**
1. POST `/api2/auth/login` - Admin login
2. POST `/api2/bookings` - Create booking
3. GET `/api2/bookings` - List bookings (admin)
4. GET `/api2/bookings/:id` - Get booking details
5. PATCH `/api2/bookings/:id/cancel` - Cancel booking
6. PATCH `/api2/bookings/:id/payment` - Update payment
7. GET `/api2/routes` - List routes
8. GET `/api2/trips` - List trips
9. GET `/api2/vehicles` - List vehicles
10. GET `/api2/passengers` - List passengers

**Driver-Facing (14):**
1. POST `/api2/bus-driver/auth/login-otp` - Send OTP for driver login
2. POST `/api2/bus-driver/auth/verify-otp` - Verify OTP & authenticate
3. GET `/api2/bus-driver/home` - Driver home dashboard (Cityflo-style) ⭐ NEW
4. GET `/api2/bus-driver/profile` - Get driver profile
5. PUT `/api2/bus-driver/profile` - Update driver profile
6. PATCH `/api2/bus-driver/duty-status` - Toggle duty status
7. GET `/api2/bus-driver/assigned-trips` - Get assigned trips
8. GET `/api2/bus-driver/trips/:id` - Get trip details & route stops ⭐
9. GET `/api2/bus-driver/trips/:id/manifest` - Get passenger manifest
10. GET `/api2/bus-driver/trips/:id/current-stop` - Get current active stop info ⭐ NEW
11. POST `/api2/bus-driver/trips/:id/stops/:stopId/arrive` - Arrive at stop with GPS ⭐ NEW
12. GET `/api2/bus-driver/trips/:id/stops/:stopId/passengers` - Get stop-specific passengers ⭐ NEW
13. POST `/api2/bus-driver/trips/:id/stops/:stopId/complete` - Mark stop completed ⭐ NEW
14. POST `/api2/bus-driver/trips/:id/stops/:stopId/mark-no-show` - Mark passenger no-show at stop ⭐ NEW
15. POST `/api2/bus-driver/available-schedules` - Get available schedules ⭐
16. POST `/api2/bus-driver/accept-assignment` - Accept assignment ⭐
17. POST `/api2/bus-driver/trips/:id/start` - Start trip ⭐
18. POST `/api2/bus-driver/scan-boarding-pass` - Scan boarding pass (with stop validation) ⭐
19. POST `/api2/bus-driver/confirm-boarding` - Confirm boarding via PIN ⭐
20. POST `/api2/bus-driver/trips/:id/complete` - Complete trip ⭐
21. POST `/api2/bus-driver/location/update` - Update GPS live location ⭐
16. POST `/api2/bus-driver/confirm-boarding` - Confirm boarding ⭐ NEW
17. POST `/api2/bus-driver/manual-verify-boarding` - Manual verify boarding ⭐ NEW
18. POST `/api2/bus-driver/location/update` - Update GPS location

---

## 1. User-Facing Public APIs (No Authentication Required)

### POST `/api2/bus/types`

**Description:** Get all active bus types with seat configurations and amenities.

**Request Body:**
```json
{}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "message": "Bus types retrieved successfully",
    "data": [
        {
            "id": 1,
            "name": "AC Sleeper",
            "code": "AC-SLEEPER",
            "total_seats": 40,
            "seat_rows": 10,
            "seat_columns": 4,
            "seat_type": "sleeper",
            "has_ac": true,
            "has_wifi": true,
            "amenities": ["WiFi", "USB Charging", "Water Bottle"],
            "description": "Premium AC Sleeper bus",
            "image": "https://example.com/images/ac-sleeper.jpg",
            "status": "Active"
        },
        {
            "id": 2,
            "name": "AC Seater",
            "code": "AC-SEATER",
            "total_seats": 45,
            "seat_rows": 9,
            "seat_columns": 5,
            "seat_type": "seater",
            "has_ac": true,
            "has_wifi": false,
            "amenities": ["USB Charging"],
            "description": "AC Seater bus",
            "image": "https://example.com/images/ac-seater.jpg",
            "status": "Active"
        }
    ]
}
```

---

### POST `/api2/bus/routes`

**Description:** Get routes with optional filters for origin and destination cities.

**Request Body:**
```json
{
    "origin_city": "Mumbai",
    "destination_city": "Pune"
}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "message": "Routes retrieved successfully",
    "data": [
        {
            "id": 1,
            "route_name": "Mumbai to Pune Express",
            "route_code": "MUM-PUN",
            "origin_city": "Mumbai",
            "destination_city": "Pune",
            "total_distance": 150.5,
            "estimated_duration": 240,
            "status": "Active",
            "stops": [
                {
                    "id": 1,
                    "stop_name": "Mumbai Central",
                    "latitude": 19.0760,
                    "longitude": 72.8777,
                    "stop_sequence": 1,
                    "stop_code": "MUM-001",
                    "address": "Mumbai Central Station",
                    "landmark": "Near Railway Station"
                },
                {
                    "id": 2,
                    "stop_name": "Pune Station",
                    "latitude": 18.5204,
                    "longitude": 73.8567,
                    "stop_sequence": 2,
                    "stop_code": "PUN-001",
                    "address": "Pune Railway Station",
                    "landmark": "Main Gate"
                }
            ]
        }
    ]
}
```

---

### POST `/api2/bus/search-routes`

**Description:** Cityflo-style location-first route search. Automatically resolves nearby candidate stops, enforces direction order (`pickup_sequence < dropoff_sequence`), supports intermediate stop boarding, dynamically generates upcoming dates, and returns direct and nearby route alternatives with schedule timings.

**Request Body (Location Object Format):**
```json
{
  "pickup": {
    "name": "TCS GITANJALI",
    "latitude": 22.5816384,
    "longitude": 88.4848711
  },
  "dropoff": {
    "name": "Narkel Bagan",
    "latitude": 22.5785751,
    "longitude": 88.4716695
  },
  "date": "2026-10-06",
  "passengers": 1
}
```

**Request Body (Flat Parameter Format Alternative):**
```json
{
  "pickup_name": "Madhyamgram",
  "pickup_latitude": 22.6947839,
  "pickup_longitude": 88.4530183,
  "dropoff_name": "Airport No. 1 Gate",
  "dropoff_latitude": 22.6415745,
  "dropoff_longitude": 88.4312932,
  "travel_date": "2026-10-06",
  "passengers": 1
}
```

**Success Response (200):**
```json
{
    "success": true,
    "message": "Routes found successfully",
    "search": {
        "pickup": "TCS GITANJALI",
        "dropoff": "Narkel Bagan",
        "date": "2026-10-06",
        "passengers": 1
    },
    "resolved_pickup": {
        "stop_id": 145,
        "name": "TCS GITANJALI",
        "matched_by": "exact",
        "distance": 0
    },
    "resolved_dropoff": {
        "stop_id": 180,
        "name": "Narkel Bagan",
        "matched_by": "exact",
        "distance": 0
    },
    "routes": [
        {
            "route_id": 48,
            "route_name": "Ecospace → Tollygunge",
            "route_code": "008-REV-1791295837",
            "pickup_stop": {
                "id": 298,
                "name": "TCS GITANJALI",
                "stop_order": 2,
                "latitude": 22.5816384,
                "longitude": 88.4848711,
                "distance": 0,
                "distance_km": 0
            },
            "dropoff_stop": {
                "id": 294,
                "name": "Narkel Bagan",
                "stop_order": 5,
                "latitude": 22.5785751,
                "longitude": 88.4716695,
                "distance": 0,
                "distance_km": 0
            },
            "pickup_distance": 0,
            "dropoff_distance": 0,
            "distance_km": 0,
            "duration_minutes": 12,
            "trips": [
                {
                    "trip_id": 48001,
                    "schedule_id": 48001,
                    "departure_time": "07:30:00",
                    "pickup_time": "7:34 AM",
                    "drop_time": "7:46 AM",
                    "available_seats": 40,
                    "bus_type": "AC Executive Shuttle"
                }
            ]
        }
    ],
    "direct_routes": [...],
    "nearby_routes": [],
    "top_pick": { ... },
    "pickup_groups": [...],
    "all_timings": [...],
    "available_dates": [
        {
            "date": "2026-10-06",
            "day": "Tue",
            "month": "Oct",
            "day_number": "6",
            "is_selected": true,
            "total_timings": 5
        }
    ],
    "summary": {
        "total_routes": 1,
        "total_timings": 5,
        "direct_routes_count": 1,
        "nearby_routes_count": 0
    }
}
```

---

### POST `/api2/bus/schedules`

**Description:** Fetch schedules for a specific route and stop pair with real-time seat counts and trip timings. Supports optional `date_key: true` to group schedules by trip date.

**Request Body (Route Stop Pair Query):**
```json
{
    "route_id": 48,
    "pickup_stop_id": 298,
    "drop_stop_id": 294,
    "date": "2026-10-06",
    "passengers": 1
}
```

**Success Response (200):**
```json
{
    "status": true,
    "message": "Schedules found",
    "search": {
        "route_id": 48,
        "pickup_stop_id": 298,
        "drop_stop_id": 294,
        "date": "2026-10-06",
        "passengers": 1
    },
    "total": 5,
    "schedules": [
        {
            "schedule_id": 48001,
            "trip_id": 48001,
            "trip_date": "2026-10-06",
            "route_id": 48,
            "bus_type_id": 1,
            "bus_type": {
                "id": 1,
                "name": "AC Executive Shuttle"
            },
            "departure_time": "07:30:00",
            "pickup_time": "7:34 AM",
            "drop_time": "7:46 AM",
            "available_seats": 40,
            "requested_seats": 1,
            "booking_allowed": true,
            "status": "active"
        }
    ]
}
```

---

### POST `/api2/bus/seat-availability`

**Description:** Check seat availability for a specific schedule and travel date. Returns seat layout with booked/unbooked status.

**Request Body:**
```json
{
    "schedule_id": 1,
    "travel_date": "2026-10-01"
}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "message": "Seat availability checked successfully",
    "data": {
        "schedule_id": 1,
        "schedule_code": "MUM-PUN-001",
        "bus_number": "MH-12-AB-1234",
        "travel_date": "2026-10-01",
        "total_seats": 40,
        "booked_seats": 15,
        "available_seats": 25,
        "booked_seat_numbers": ["1A", "1B", "2A", "2B", "3A", "3B", "4A", "4B", "5A", "5B", "6A", "6B", "7A", "7B", "8A"],
        "seat_layout": [
            {
                "seat_number": "1A",
                "row": 1,
                "column": 1,
                "is_available": false
            },
            {
                "seat_number": "1B",
                "row": 1,
                "column": 2,
                "is_available": false
            },
            {
                "seat_number": "1C",
                "row": 1,
                "column": 3,
                "is_available": true
            },
            {
                "seat_number": "1D",
                "row": 1,
                "column": 4,
                "is_available": true
            }
        ],
        "schedule": {
            "departure_time": "06:00:00",
            "arrival_time": "10:00:00",
            "base_fare": 350.00,
            "bus_type": {
                "id": 1,
                "name": "AC Sleeper",
                "total_seats": 40
            },
            "route": {
                "route_name": "Mumbai to Pune Express"
            }
        }
    }
}
```

---

### POST `/api2/bus/calculate-fare`

**Description:** Calculate fare for a specific schedule with optional origin and destination stops.

**Request Body:**
```json
{
    "schedule_id": 1,
    "origin_stop_id": 1,
    "destination_stop_id": 2,
    "seat_count": 2
}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "message": "Fare calculated successfully",
    "data": {
        "schedule_id": 1,
        "schedule_code": "MUM-PUN-001",
        "origin_stop_id": 1,
        "destination_stop_id": 2,
        "distance_km": 150.5,
        "base_fare": 100.00,
        "fare_per_km": 3.00,
        "seat_count": 2,
        "fare_per_seat": 551.50,
        "total_fare": 1103.00,
        "currency": "INR"
    }
}
```

---

### POST `/api2/bus/user-bookings`

**Description:** Get user's bookings with optional filters for status and travel date. Can search by passenger_id or passenger_mobile.

**Request Body:**
```json
{
    "passenger_mobile": "9876543210",
    "booking_status": "confirmed",
    "travel_date": "2026-10-01",
    "page": 1,
    "limit": 20
}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "message": "User bookings retrieved successfully",
    "data": [
        {
            "id": 100,
            "booking_reference": "BK-1727771234567-456",
            "passenger_name": "Rahul Kumar",
            "passenger_mobile": "9876543210",
            "travel_date": "2026-10-01",
            "seat_numbers": ["1A", "1B"],
            "total_seats": 2,
            "total_fare": 1103.00,
            "final_amount": 1103.00,
            "payment_status": "paid",
            "booking_status": "confirmed",
            "boarding_pass_code": "BP-8F72K9M4",
            "boarding_pin": "4821",
            "boarding_status": "not_boarded",
            "trip": {
                "id": 1,
                "schedule_code": "MUM-PUN-001",
                "departure_time": "06:00:00",
                "route": {
                    "route_name": "Mumbai to Pune Express"
                }
            },
            "origin_stop": {
                "id": 1,
                "stop_name": "Mumbai Central"
            },
            "destination_stop": {
                "id": 2,
                "stop_name": "Pune Station"
            },
            "passenger": {
                "id": 42,
                "name": "Rahul Kumar",
                "mobile": "9876543210",
                "email": "rahul@example.com"
            }
        }
    ],
    "pagination": {
        "total": 5,
        "page": 1,
        "limit": 20,
        "pages": 1
    }
}
```

---

### POST `/api2/bus/booking-details`

**Description:** Get detailed booking information for boarding pass. Can search by booking_id, booking_reference, or boarding_pass_code.

**Request Body:**
```json
{
    "boarding_pass_code": "BP-8F72K9M4"
}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "message": "Booking details retrieved successfully",
    "data": {
        "booking_id": 100,
        "booking_reference": "BK-1727771234567-456",
        "passenger_name": "Rahul Kumar",
        "passenger_mobile": "9876543210",
        "passenger_email": "rahul@example.com",
        "travel_date": "2026-10-01",
        "seat_numbers": ["1A", "1B"],
        "total_seats": 2,
        "total_fare": 1103.00,
        "discount_amount": 0,
        "final_amount": 1103.00,
        "payment_status": "paid",
        "booking_status": "confirmed",
        "boarding_pass_code": "BP-8F72K9M4",
        "boarding_pin": "4821",
        "boarding_status": "not_boarded",
        "boarded_at": null,
        "qr_token": "550e8400-e29b-41d4-a716-446655440000",
        "trip": {
            "trip_id": 1,
            "schedule_code": "MUM-PUN-001",
            "departure_time": "06:00:00",
            "arrival_time": "10:00:00",
            "route": {
                "route_name": "Mumbai to Pune Express",
                "origin_city": "Mumbai",
                "destination_city": "Pune"
            }
        },
        "origin_stop": {
            "id": 1,
            "stop_name": "Mumbai Central",
            "address": "Mumbai Central Station"
        },
        "destination_stop": {
            "id": 2,
            "stop_name": "Pune Station",
            "address": "Pune Railway Station"
        }
    }
}
```

**Error Response (404):**
```json
{
    "status": 404,
    "success": false,
    "message": "Booking not found"
}
```

---

### POST `/api2/bus/cancel-booking`

**Description:** Cancel a user booking and process refund if paid.

**Request Body:**
```json
{
    "booking_id": 100,
    "cancellation_reason": "Change of plans"
}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "message": "Booking cancelled successfully",
    "data": {
        "booking_id": 100,
        "booking_reference": "BK-1727771234567-456",
        "booking_status": "cancelled",
        "payment_status": "refunded",
        "cancelled_at": "2026-10-01T10:30:00.000Z"
    }
}
```

**Error Response (400):**
```json
{
    "status": 400,
    "success": false,
    "message": "Booking already cancelled"
}
```

---

## 2. Admin Authentication

### POST `/api2/auth/login`

**Description:** Admin user login with email and password.

**Request Body:**
```json
{
    "email": "admin@example.com",
    "password": "password123"
}
```

**Success Response (200):**
```json
{
    "success": true,
    "message": "Login successful",
    "data": {
        "user": {
            "id": 1,
            "name": "Admin User",
            "email": "admin@example.com",
            "role": {
                "id": 1,
                "name": "admin",
                "permissions": [
                    "bookings.read",
                    "bookings.manage",
                    "routes.read",
                    "trips.read"
                ]
            }
        },
        "permissions": ["bookings.read", "bookings.manage", "routes.read", "trips.read"],
        "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
}
```

**Error Response (401):**
```json
{
    "success": false,
    "message": "Invalid email or password"
}
```

---

## 2. Create Booking

### POST `/api2/bookings`

**Description:** Creates a bus booking and generates QR code (boarding_pass_code) and 4-digit PIN for boarding verification.

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Request Body:**
```json
{
    "trip_id": 1,
    "passenger_id": 42,
    "passenger_name": "Rahul Kumar",
    "passenger_mobile": "9876543210",
    "passenger_email": "rahul@example.com",
    "origin_stop_id": 1,
    "destination_stop_id": 2,
    "travel_date": "2026-10-01",
    "seat_numbers": ["1A"],
    "total_seats": 1,
    "payment_method": "cash",
    "coupon_id": null,
    "special_requests": null
}
```

**Success Response (201):**
```json
{
    "success": true,
    "message": "Booking confirmed",
    "data": {
        "id": 100,
        "booking_reference": "BK-1727771234567-456",
        "trip_id": 1,
        "passenger_id": 42,
        "passenger_name": "Rahul Kumar",
        "passenger_mobile": "9876543210",
        "passenger_email": "rahul@example.com",
        "origin_stop_id": 1,
        "destination_stop_id": 2,
        "travel_date": "2026-10-01",
        "seat_numbers": ["1A"],
        "total_seats": 1,
        "total_fare": 350.00,
        "discount_amount": 0,
        "final_amount": 350.00,
        "payment_status": "pending",
        "payment_method": "cash",
        "booking_status": "confirmed",
        "boarding_pass_code": "BP-8F72K9M4",
        "boarding_pin": "4821",
        "boarding_status": "not_boarded",
        "qr_token": "550e8400-e29b-41d4-a716-446655440000",
        "status": "Active",
        "trip": {
            "id": 1,
            "schedule_code": "MUM-PUN-001",
            "departure_time": "06:00:00",
            "arrival_time": "10:00:00",
            "base_fare": 350.00,
            "seat_capacity": 40,
            "route": {
                "id": 1,
                "route_name": "Mumbai to Pune Express",
                "route_code": "MUM-PUN",
                "origin_city": "Mumbai",
                "destination_city": "Pune"
            }
        },
        "origin_stop": {
            "id": 1,
            "stop_name": "Mumbai Central"
        },
        "destination_stop": {
            "id": 2,
            "stop_name": "Pune Station"
        }
    }
}
```

**Seat Already Booked Conflict Error Response (409 Conflict):**
```json
{
    "status": 409,
    "success": false,
    "message": "Seat A1 is already booked",
    "code": "SEAT_ALREADY_BOOKED",
    "data": {
        "trip_id": 25,
        "seat_number": "A1"
    }
}
```

**What the User App Shows:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      BOOKING CONFIRMED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Mumbai Central → Pune Station

Bus: MH-12-AB-1234
Date: 01 Oct 2026
Departure: 06:00

Seat: 1A

      [ QR CODE IMAGE ]
      BP-8F72K9M4

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      Boarding PIN
          4821
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Show this QR to the driver
when boarding the bus.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Backend Logic:**
- Generates unique `booking_reference`: `BK-{timestamp}-{random}`
- Generates unique `boarding_pass_code`: `BP-` + 6 random alphanumeric characters
- Generates random 4-digit `boarding_pin`: 1000-9999
- Sets `boarding_status` to `not_boarded`
- Generates `qr_token` using UUID
- User app generates QR image from `boarding_pass_code` value

**Security:**
- QR contains ONLY the opaque `boarding_pass_code`
- PIN is separate and shown to user
- No sensitive data (name, phone, booking details) in QR

---

## 3. Get Booking Details

### GET `/api2/bookings/:id`

**Description:** Get detailed booking information by ID.

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Success Response (200):**
```json
{
    "success": true,
    "data": {
        "id": 100,
        "booking_reference": "BK-1727771234567-456",
        "trip_id": 1,
        "passenger_id": 42,
        "passenger_name": "Rahul Kumar",
        "passenger_mobile": "9876543210",
        "boarding_pass_code": "BP-8F72K9M4",
        "boarding_pin": "4821",
        "boarding_status": "not_boarded",
        "trip": {
            "id": 1,
            "schedule_code": "MUM-PUN-001",
            "route": {
                "route_name": "Mumbai to Pune Express"
            }
        },
        "origin_stop": {
            "stop_name": "Mumbai Central"
        },
        "destination_stop": {
            "stop_name": "Pune Station"
        },
        "payments": [],
        "refunds": []
    }
}
```

---

## 4. Cancel Booking

### PATCH `/api2/bookings/:id/cancel`

**Description:** Cancel a booking and process refund if paid.

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Request Body:**
```json
{
    "cancellation_reason": "Passenger requested cancellation"
}
```

**Success Response (200):**
```json
{
    "success": true,
    "message": "Booking cancelled",
    "data": {
        "id": 100,
        "booking_status": "cancelled",
        "payment_status": "refunded",
        "status": "Cancelled",
        "cancellation_reason": "Passenger requested cancellation",
        "cancelled_at": "2026-10-01T10:30:00.000Z"
    }
}
```

---

## 5. List Bookings

### GET `/api2/bookings`

**Description:** List all bookings with filtering and pagination.

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 15, max: 100)
- `search` (optional): Search by booking reference, passenger name, or mobile
- `booking_status` (optional): Filter by booking status
- `payment_status` (optional): Filter by payment status
- `trip_id` (optional): Filter by trip ID
- `from_date` (optional): Filter by travel date from
- `to_date` (optional): Filter by travel date to

**Example Request:**
```
GET /api2/bookings?page=1&limit=20&booking_status=confirmed&from_date=2026-10-01&to_date=2026-10-31
```

**Success Response (200):**
```json
{
    "success": true,
    "data": [
        {
            "id": 100,
            "booking_reference": "BK-1727771234567-456",
            "passenger_name": "Rahul Kumar",
            "passenger_mobile": "9876543210",
            "travel_date": "2026-10-01",
            "seat_numbers": ["1A"],
            "total_fare": 350.00,
            "booking_status": "confirmed",
            "payment_status": "paid",
            "boarding_status": "not_boarded",
            "trip": {
                "schedule_code": "MUM-PUN-001",
                "route": {
                    "route_name": "Mumbai to Pune Express"
                }
            }
        }
    ],
    "pagination": {
        "total": 150,
        "page": 1,
        "limit": 20,
        "pages": 8
    }
}
```

---

## 6. Driver Authentication

### POST `/api2/bus-driver/auth/login-otp`

**Description:** Generate a 4-digit OTP, send it to the driver's registered mobile number via Fast2SMS DLT gateway, and store it in-memory with a 10-minute TTL.

**Request Body:**
```json
{
    "mobile": "9876543210"
}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "message": "OTP sent successfully to registered mobile number",
    "data": {
        "mobile": "9876543210",
        "otp_demo": "4829",
        "sms_sent": true
    }
}
```

**Error Response (404):**
```json
{
    "status": 404,
    "success": false,
    "message": "Driver mobile number not registered. Please contact operator admin."
}
```

**Error Response (403):**
```json
{
    "status": 403,
    "success": false,
    "message": "Your driver account has been blocked"
}
```

---

### POST `/api2/bus-driver/auth/verify-otp`

**Description:** Verify OTP and authenticate driver.

**Request Body:**
```json
{
    "mobile": "9876543210",
    "otp": "1234",
    "device_id": "device_unique_id_123"
}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "message": "Login successful",
    "data": {
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        "driver": {
            "id": 5,
            "driver_user_id": 10,
            "name": "Rajesh Kumar",
            "email": "rajesh@example.com",
            "mobile": "9876543210",
            "online_status": "Online",
            "status": "Approve",
            "photo": "https://example.com/photos/driver5.jpg",
            "details": {
                "id": 5,
                "driver_id": 5,
                "license_number": "MH-2023-567890",
                "license_expiry": "2028-12-31"
            }
        }
    }
}
```

**Error Response (400):**
```json
{
    "status": 400,
    "success": false,
    "message": "Invalid OTP code"
}
```

---

## 7. Driver Profile

### GET `/api2/bus-driver/profile`

**Description:** Get driver profile information.

**Headers:**
```
Authorization: Bearer {driverToken}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "data": {
        "id": 5,
        "name": "Rajesh Kumar",
        "email": "rajesh@example.com",
        "mobile": "9876543210",
        "online_status": "Online",
        "status": "Approve",
        "photo": "https://example.com/photos/driver5.jpg",
        "details": {
            "id": 5,
            "driver_id": 5,
            "license_number": "MH-2023-567890",
            "license_expiry": "2028-12-31"
        },
        "vehicles": [
            {
                "id": 10,
                "registration_number": "MH-12-AB-1234",
                "model": "Volvo 9400",
                "bus_type": {
                    "id": 6,
                    "name": "AC Sleeper",
                    "total_seats": 40
                }
            }
        ]
    }
}
```

---

### PUT `/api2/bus-driver/profile`

**Description:** Update driver profile.

**Headers:**
```
Authorization: Bearer {driverToken}
```

**Request Body:**
```json
{
    "name": "Rajesh Kumar",
    "email": "rajesh@example.com",
    "device_id": "device_unique_id_123",
    "address": "123 Main Street, Mumbai"
}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "message": "Profile updated successfully",
    "data": {
        "id": 5,
        "name": "Rajesh Kumar",
        "email": "rajesh@example.com",
        "device_id": "device_unique_id_123",
        "address": "123 Main Street, Mumbai"
    }
}
```

---

### PATCH `/api2/bus-driver/duty-status`

**Description:** Toggle driver duty status (Online/Offline).

**Headers:**
```
Authorization: Bearer {driverToken}
```

**Request Body:**
```json
{
    "online_status": "Online"
}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "message": "Duty status updated to Online",
    "data": {
        "driver_id": 5,
        "online_status": "Online"
    }
}
```

---

## 8. Driver Assignments

### POST `/api2/bus-driver/available-schedules`

**Description:** Get available schedules for driver to accept assignment.

**Headers:**
```
Authorization: Bearer {driverToken}
```

**Request Body:**
```json
{
    "assignment_date": "2026-10-01"
}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "message": "Available schedules retrieved successfully",
    "data": [
        {
            "id": 1,
            "schedule_code": "MUM-PUN-001",
            "departure_time": "06:00:00",
            "arrival_time": "10:00:00",
            "operating_days": "monday,tuesday,wednesday,thursday,friday,saturday,sunday",
            "base_fare": 350.00,
            "seat_capacity": 40,
            "valid_from": "2026-01-01",
            "valid_until": "2026-12-31",
            "status": "Active",
            "route": {
                "id": 1,
                "route_name": "Mumbai to Pune Express",
                "route_code": "MUM-PUN",
                "origin_city": "Mumbai",
                "destination_city": "Pune",
                "stops": [
                    {
                        "id": 1,
                        "stop_name": "Mumbai Central",
                        "city": "Mumbai",
                        "stop_sequence": 1
                    },
                    {
                        "id": 2,
                        "stop_name": "Pune Station",
                        "city": "Pune",
                        "stop_sequence": 2
                    }
                ]
            },
            "bus_type": {
                "id": 6,
                "name": "AC Sleeper",
                "total_seats": 40
            }
        }
    ]
}
```

---

### POST `/api2/bus-driver/accept-assignment`

**Description:** Accept a schedule assignment for a specific date.

**Headers:**
```
Authorization: Bearer {driverToken}
```

**Request Body:**
```json
{
    "schedule_id": 1,
    "assignment_date": "2026-10-01"
}
```

**Success Response (201):**
```json
{
    "status": 201,
    "success": true,
    "message": "Assignment accepted successfully",
    "data": {
        "id": 10,
        "schedule_id": 1,
        "driver_id": 5,
        "assignment_date": "2026-10-01",
        "reporting_time": "06:00:00",
        "status": "assigned",
        "start_odometer": null,
        "end_odometer": null,
        "notes": null,
        "schedule": {
            "id": 1,
            "schedule_code": "MUM-PUN-001",
            "route": {
                "route_name": "Mumbai to Pune Express"
            },
            "bus_type": {
                "name": "AC Sleeper"
            }
        }
    }
}
```

---

### POST `/api2/bus-driver/my-assignments`

**Description:** Get driver's assignments.

**Headers:**
```
Authorization: Bearer {driverToken}
```

**Request Body:**
```json
{}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "message": "Assignments retrieved successfully",
    "data": [
        {
            "id": 10,
            "schedule_id": 1,
            "driver_id": 5,
            "assignment_date": "2026-10-01",
            "reporting_time": "06:00:00",
            "status": "assigned",
            "distance_km": null,
            "schedule": {
                "id": 1,
                "schedule_code": "MUM-PUN-001",
                "departure_time": "06:00:00",
                "route": {
                    "route_name": "Mumbai to Pune Express",
                    "stops": [
                        {
                            "stop_name": "Mumbai Central",
                            "stop_sequence": 1
                        },
                        {
                            "stop_name": "Pune Station",
                            "stop_sequence": 2
                        }
                    ]
                },
                "bus_type": {
                    "name": "AC Sleeper"
                }
            }
        }
    ]
}
```

---

### POST `/api2/bus-driver/assignments/:id/start`

**Description:** Start an assignment (record start odometer).

**Headers:**
```
Authorization: Bearer {driverToken}
```

**Request Body:**
```json
{
    "start_odometer": 15000.5
}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "message": "Assignment started successfully",
    "data": {
        "id": 10,
        "status": "started",
        "start_odometer": 15000.5
    }
}
```

---

### POST `/api2/bus-driver/assignments/:id/complete`

**Description:** Complete an assignment (record end odometer).

**Headers:**
```
Authorization: Bearer {driverToken}
```

**Request Body:**
```json
{
    "end_odometer": 15250.8,
    "notes": "Trip completed successfully"
}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "message": "Assignment completed successfully",
    "data": {
        "id": 10,
        "status": "completed",
        "end_odometer": 15250.8,
        "distance_km": 250.3,
        "notes": "Trip completed successfully"
    }
}
```

---

## 9. Driver Trip Management

### GET `/api2/bus-driver/assigned-trips`

**Description:** Get driver's assigned trips with passenger summary.

**Headers:**
```
Authorization: Bearer {driverToken}
```

**Query Parameters:**
- `status` (optional): Filter by trip status
- `date` (optional): Filter by trip date

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "data": [
        {
            "trip_id": 1,
            "schedule_code": "MUM-PUN-001",
            "route_id": 1,
            "route_name": "Mumbai to Pune Express",
            "source_city": "Mumbai",
            "destination_city": "Pune",
            "trip_date": "2026-10-01",
            "departure_time": "06:00:00",
            "arrival_time": "10:00:00",
            "status": "Scheduled",
            "vehicle": {
                "id": 10,
                "vehicle_number": "MH-12-AB-1234",
                "model": "Volvo 9400",
                "bus_type": "AC Sleeper"
            },
            "summary": {
                "total_capacity": 40,
                "total_bookings": 25,
                "total_booked_seats": 25,
                "boarded_passengers": 10,
                "pending_passengers": 15
            },
            "started_at": null,
            "completed_at": null
        }
    ]
}
```

---

### GET `/api2/bus-driver/trips/:id`

**Description:** Get trip details with route stops and seat info.

**Headers:**
```
Authorization: Bearer {driverToken}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "data": {
        "id": 1,
        "schedule_code": "MUM-PUN-001",
        "departure_time": "06:00:00",
        "arrival_time": "10:00:00",
        "base_fare": 350.00,
        "seat_capacity": 40,
        "trip_date": "2026-10-01",
        "status": "Scheduled",
        "route": {
            "id": 1,
            "route_name": "Mumbai to Pune Express",
            "stops": [
                {
                    "id": 1,
                    "stop_name": "Mumbai Central",
                    "city": "Mumbai",
                    "stop_sequence": 1
                },
                {
                    "id": 2,
                    "stop_name": "Pune Station",
                    "city": "Pune",
                    "stop_sequence": 2
                }
            ]
        },
        "vehicle": {
            "id": 10,
            "registration_number": "MH-12-AB-1234",
            "model": "Volvo 9400",
            "bus_type": {
                "name": "AC Sleeper"
            }
        },
        "bookings": [
            {
                "id": 100,
                "boarding_status": "not_boarded",
                "seat_numbers": ["1A"],
                "total_seats": 1,
                "origin_stop": {
                    "stop_name": "Mumbai Central"
                },
                "destination_stop": {
                    "stop_name": "Pune Station"
                }
            }
        ]
    }
}
```

---

### GET `/api2/bus-driver/trips/:id/manifest`

**Description:** Get passenger manifest for a trip with boarding status.

**Headers:**
```
Authorization: Bearer {driverToken}
```

**Query Parameters:**
- `boarding_status` (optional): Filter by boarding status ('not_boarded', 'boarded')
- `search` (optional): Search by passenger name, mobile, booking reference, or boarding pass code

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "data": {
        "trip_id": 1,
        "schedule_code": "MUM-PUN-001",
        "route_name": "Mumbai to Pune Express",
        "stats": {
            "total_passengers": 25,
            "boarded_passengers": 10,
            "pending_passengers": 15
        },
        "passengers": [
            {
                "booking_id": 100,
                "booking_reference": "BK-1727771234567-456",
                "passenger_name": "Rahul Kumar",
                "passenger_mobile_masked": "98XXXXXX10",
                "seat_numbers": ["1A"],
                "total_seats": 1,
                "origin_stop": "Mumbai Central",
                "destination_stop": "Pune Station",
                "boarding_status": "not_boarded",
                "boarding_pass_code": "BP-8F72K9M4",
                "boarded_at": null,
                "payment_status": "paid"
            }
        ]
    }
}
```

---

### GET `/api2/bus-driver/home`

**Description:** Get driver home dashboard overview (Cityflo-style captain view), including active trip, current stop, next stop, and boarding counters.

**Headers:**
```
Authorization: Bearer {driverToken}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "data": {
        "driver": {
            "id": 2,
            "name": "Rajesh Kumar",
            "online_status": "Online"
        },
        "today": {
            "date": "2026-10-05"
        },
        "current_trip": {
            "trip_id": 101,
            "schedule_code": "SCH-2026-7528",
            "status": "Active",
            "bus_number": "WB-12-AB-1234",
            "route_name": "New Town → Sector V",
            "departure_time": "08:00:00",
            "trip_date": "2026-10-05"
        },
        "current_stop": {
            "stop_id": 12,
            "name": "City Centre 2",
            "sequence": 2,
            "eta": "08:18:00"
        },
        "next_stop": {
            "stop_id": 13,
            "name": "Eco Park",
            "sequence": 3
        },
        "boarding": {
            "total": 18,
            "boarded": 12,
            "pending": 6
        }
    }
}
```

---

### GET `/api2/bus-driver/trips/:id/current-stop`

**Description:** Get real-time current stop info for an active trip, including ETA, location coordinates, and stop boarding summary.

**Headers:**
```
Authorization: Bearer {driverToken}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "data": {
        "trip_id": 101,
        "stop": {
            "id": 12,
            "name": "City Centre 2",
            "sequence": 2,
            "latitude": 22.5901,
            "longitude": 88.4781,
            "scheduled_time": "08:00:00",
            "eta": "08:02:00"
        },
        "passengers": {
            "total": 8,
            "boarded": 5,
            "pending": 3
        }
    }
}
```

---

### POST `/api2/bus-driver/trips/:id/stops/:stopId/arrive`

**Description:** Mark bus arrival at a specific stop along the route with GPS coordinates.

**Headers:**
```
Authorization: Bearer {driverToken}
Content-Type: application/json
```

**Request Body:**
```json
{
    "latitude": 22.5901,
    "longitude": 88.4781
}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "message": "Arrived at stop City Centre 2",
    "data": {
        "trip_id": 101,
        "stop_id": 12,
        "stop_name": "City Centre 2",
        "arrived_at": "2026-10-05T08:01:30.000Z",
        "arrival_latitude": 22.5901,
        "arrival_longitude": 88.4781,
        "status": "ARRIVED"
    }
}
```

---

### GET `/api2/bus-driver/trips/:id/stops/:stopId/passengers`

**Description:** Get stop-specific passenger manifest for boarding authentication at the current pickup stop.

**Headers:**
```
Authorization: Bearer {driverToken}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "data": {
        "stop": {
            "id": 12,
            "name": "City Centre 2"
        },
        "summary": {
            "total": 8,
            "boarded": 5,
            "pending": 3,
            "no_show": 0
        },
        "passengers": [
            {
                "booking_id": 1001,
                "booking_reference": "BK-1727771234567-456",
                "passenger_name": "Rahul Kumar",
                "passenger_mobile_masked": "98XXXXXX10",
                "seat": "1A",
                "boarding_status": "boarded",
                "boarding_pass_code": "BP-8F72K9M4",
                "boarded_at": "2026-10-05T08:02:10.000Z"
            },
            {
                "booking_id": 1002,
                "booking_reference": "BK-1727771234567-457",
                "passenger_name": "Amit Sharma",
                "passenger_mobile_masked": "98XXXXXX20",
                "seat": "2B",
                "boarding_status": "not_boarded",
                "boarding_pass_code": "BP-9G83L1N5",
                "boarded_at": null
            }
        ]
    }
}
```

---

### POST `/api2/bus-driver/trips/:id/stops/:stopId/complete`

**Description:** Mark boarding completed for a stop and advance to the next route stop.

**Headers:**
```
Authorization: Bearer {driverToken}
Content-Type: application/json
```

**Request Body:**
```json
{
    "latitude": 22.5905,
    "longitude": 88.4785
}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "message": "Stop completed successfully",
    "data": {
        "stop_id": 12,
        "total_passengers": 8,
        "boarded": 7,
        "no_show": 1,
        "completed_at": "2026-10-05T08:05:00.000Z",
        "next_stop": {
            "stop_id": 13,
            "name": "Eco Park",
            "sequence": 3
        }
    }
}
```

---

### POST `/api2/bus-driver/trips/:id/stops/:stopId/mark-no-show`

**Description:** Mark a passenger who did not show up at their pickup stop as no-show.

**Headers:**
```
Authorization: Bearer {driverToken}
Content-Type: application/json
```

**Request Body:**
```json
{
    "booking_id": 1002,
    "reason": "Passenger did not arrive at stop"
}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "message": "Passenger marked as no-show",
    "data": {
        "booking_id": 1002,
        "booking_reference": "BK-1727771234567-457",
        "passenger_name": "Amit Sharma",
        "boarding_status": "no_show"
    }
}
```

---

### POST `/api2/bus-driver/trips/:id/start`

**Description:** Start a trip.

**Headers:**
```
Authorization: Bearer {driverToken}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "message": "Trip started successfully",
    "data": {
        "trip_id": 1,
        "status": "Active",
        "started_at": "2026-10-01T05:55:00.000Z"
    }
}
```

---

### POST `/api2/bus-driver/trips/:id/complete`

**Description:** Complete a trip.

**Headers:**
```
Authorization: Bearer {driverToken}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "message": "Trip completed successfully",
    "data": {
        "trip_id": 1,
        "status": "Completed",
        "completed_at": "2026-10-01T10:30:00.000Z"
    }
}
```

---

## 10. Scan Boarding Pass ⭐ NEW

### POST `/api2/bus-driver/scan-boarding-pass`

**Description:** Driver scans passenger's QR code. Backend validates the QR and returns passenger information. Does NOT mark as boarded yet - just validates and returns info.

**Headers:**
```
Authorization: Bearer {driverToken}
```

**Request Body:**
```json
{
    "trip_id": 1,
    "assignment_id": 10,
    "boarding_pass_code": "BP-8F72K9M4"
}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "message": "Boarding pass verified successfully",
    "data": {
        "booking_id": 100,
        "booking_reference": "BK-1727771234567-456",
        "passenger_name": "Rahul Kumar",
        "passenger_mobile_masked": "98XXXXXX10",
        "seat_numbers": ["1A"],
        "origin": "Mumbai Central",
        "destination": "Pune Station",
        "boarding_pin_required": true,
        "boarding_status": "not_boarded"
    }
}
```

**Error Responses:**

**Invalid QR Code (404):**
```json
{
    "status": 404,
    "success": false,
    "message": "Invalid boarding pass code. Ticket not found."
}
```

**Wrong Bus/Schedule (400):**
```json
{
    "status": 400,
    "success": false,
    "message": "This booking is for a different bus trip schedule"
}
```

**Already Boarded (400):**
```json
{
    "status": 400,
    "success": false,
    "message": "Passenger has already boarded this bus",
    "data": {
        "booking_id": 100,
        "passenger_name": "Rahul Kumar",
        "seat_numbers": ["1A"],
        "boarded_at": "2026-10-01T05:52:30.000Z"
    }
}
```

**What Driver App Shows After Scan:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      ✓ VALID TICKET
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Passenger: Rahul Kumar
Mobile: 98XXXXXX10

Seat: 1A

Mumbai Central → Pune Station

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    Enter Passenger PIN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    [  ]  [  ]  [  ]  [  ]

    [ CONFIRM BOARDING ]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Backend Validations:**
1. ✓ Does `boarding_pass_code` exist in `bookings`?
2. ✓ Is `booking_status` = 'confirmed'?
3. ✓ Does `booking.trip_id` = driver's trip_id?
4. ✓ Is `boarding_status` != 'boarded'?

**Security:**
- Partial mobile masking: `98XXXXXX10`
- Validates driver can only scan passengers for their assigned trip
- Prevents scanning tickets for wrong trip
- Prevents double-boarding

---

## 11. Confirm Boarding ⭐ NEW

### POST `/api2/bus-driver/confirm-boarding`

**Description:** Driver enters the PIN to confirm passenger boarding. Backend verifies PIN and marks passenger as boarded.

**Headers:**
```
Authorization: Bearer {driverToken}
```

**Request Body:**
```json
{
    "trip_id": 42,
    "boarding_pin": "4821"
}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "message": "Passenger boarding confirmed successfully",
    "data": {
        "booking_id": 100,
        "booking_reference": "BK-1727771234567-456",
        "passenger_name": "Rahul Kumar",
        "seat_numbers": ["1A"],
        "boarding_status": "boarded",
        "boarding_time": "05:52:30",
        "boarded_at": "2026-10-01T05:52:30.000Z"
    }
}
```

**Error Responses:**

**Invalid PIN (400):**
```json
{
    "status": 400,
    "success": false,
    "message": "Invalid boarding PIN code entered"
}
```

**Already Boarded (400):**
```json
{
    "status": 400,
    "success": false,
    "message": "Passenger already boarded",
    "data": {
        "booking_id": 100,
        "boarded_at": "2026-10-01T05:52:30.000Z"
    }
}
```

**What Driver App Shows After Confirmation:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ✓ BOARDING CONFIRMED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Rahul Kumar
Seat 1A

Boarded at: 05:52 AM

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Backend Actions:**
1. Verify PIN matches `booking.boarding_pin` (or use master override PIN '9999' in emergency)
2. Validate assignment and trip (same checks as scan)
3. Update database:
   ```javascript
   boarding_status = 'boarded'
   boarded_at = new Date()
   boarding_time = currentTimeString
   ```

**Security:**
- PIN verification prevents screenshot fraud
- Validates driver assignment matches booking
- Prevents double-boarding
- Emergency override PIN '9999' for special cases

---

## 12. Manual Verify Boarding ⭐ NEW

### POST `/api2/bus-driver/manual-verify-boarding`

**Description:** Manual passenger boarding verification by searching with booking reference, mobile number, or boarding pass code.

**Headers:**
```
Authorization: Bearer {driverToken}
```

**Request Body:**
```json
{
    "trip_id": 1,
    "query": "9876543210"
}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "data": {
        "booking_id": 100,
        "booking_reference": "BK-1727771234567-456",
        "passenger_name": "Rahul Kumar",
        "passenger_mobile": "9876543210",
        "seat_numbers": ["1A"],
        "boarding_status": "not_boarded",
        "boarding_pin": "4821"
    }
}
```

**Error Response (404):**
```json
{
    "status": 404,
    "success": false,
    "message": "Passenger booking not found for this trip"
}
```

---

## 13. Update GPS Location

### POST `/api2/bus-driver/location/update`

**Description:** Update driver's GPS location for live tracking.

**Headers:**
```
Authorization: Bearer {driverToken}
```

**Request Body:**
```json
{
    "latitude": 19.0760,
    "longitude": 72.8777,
    "speed": 45.5,
    "heading": 90,
    "trip_id": 1
}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "message": "Location updated successfully",
    "data": {
        "driver_id": 5,
        "latitude": 19.0760,
        "longitude": 72.8777,
        "speed": 45.5,
        "heading": 90,
        "updated_at": "2026-10-01T06:30:00.000Z"
    }
}
```

---

## 14. Driver History & Earnings

### GET `/api2/bus-driver/history`

**Description:** Get driver's trip history.

**Headers:**
```
Authorization: Bearer {driverToken}
```

**Query Parameters:**
- `limit` (optional): Items per page (default: 20, max: 100)
- `page` (optional): Page number (default: 1)

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "data": [
        {
            "trip_id": 1,
            "schedule_code": "MUM-PUN-001",
            "route_name": "Mumbai to Pune Express",
            "trip_date": "2026-10-01",
            "started_at": "2026-10-01T05:55:00.000Z",
            "completed_at": "2026-10-01T10:30:00.000Z",
            "total_bookings": 25,
            "boarded_passengers": 23
        }
    ],
    "pagination": {
        "total": 50,
        "page": 1,
        "limit": 20,
        "pages": 3
    }
}
```

---

### GET `/api2/bus-driver/earnings`

**Description:** Get driver's earnings summary.

**Headers:**
```
Authorization: Bearer {driverToken}
```

**Success Response (200):**
```json
{
    "status": 200,
    "success": true,
    "data": {
        "driver_id": 5,
        "driver_name": "Rajesh Kumar",
        "total_completed_trips": 50,
        "total_passengers_boarded": 1150,
        "rating": 4.8,
        "duty_status": "Online"
    }
}
```

---

## Complete Boarding Flow

### Step-by-Step Process

**1. Admin Creates Trip/Schedule**
```
POST /api2/trips
```
↓
```
Backend creates:
- schedule_code: MUM-PUN-001
- route_id, bus_type_id
- departure_time, arrival_time
- base_fare, seat_capacity
```

**2. Driver Accepts Assignment**
```
POST /api2/bus-driver/available-schedules
{
    "assignment_date": "2026-10-01"
}
```
↓
```
POST /api2/bus-driver/accept-assignment
{
    "schedule_id": 1,
    "assignment_date": "2026-10-01"
}
```
↓
```
Backend creates assignment:
- driver_id: 5
- schedule_id: 1
- assignment_date: 2026-10-01
- status: assigned
```

**3. User Books Ticket**
```
POST /api2/bookings
{
    "trip_id": 1,
    "passenger_name": "Rahul Kumar",
    "passenger_mobile": "9876543210",
    "seat_numbers": ["1A"],
    "travel_date": "2026-10-01"
}
```
↓
```
Backend generates:
- booking_reference: BK-1727771234567-456
- boarding_pass_code: BP-8F72K9M4
- boarding_pin: 4821
- qr_token: UUID
```

**4. User Shows QR to Driver**
```
User App displays:
- QR Code (contains: BP-8F72K9M4)
- PIN (shows: 4821)
```

**5. Driver Starts Trip**
```
POST /api2/bus-driver/trips/:id/start
```
↓
```
Backend updates:
- trip.status = 'Active'
- trip.started_at = NOW()
```

**6. Driver Scans QR**
```
POST /api2/bus-driver/scan-boarding-pass
{
    "trip_id": 1,
    "boarding_pass_code": "BP-8F72K9M4"
}
```
↓
```
Backend validates:
✓ Valid QR
✓ Correct trip
✓ Not already boarded
```
↓
```
Returns passenger info
Driver app shows PIN entry
```

**7. Driver Enters PIN**
```
POST /api2/bus-driver/confirm-boarding
{
    "trip_id": 42,
    "boarding_pin": "4821"
}
```
↓
```
Backend verifies PIN
Marks as boarded
Returns confirmation
```

**8. Driver Completes Trip**
```
POST /api2/bus-driver/trips/:id/complete
```
↓
```
Backend updates:
- trip.status = 'Completed'
- trip.completed_at = NOW()
```

---

## Why Use PIN + QR?

### QR Alone Has Risks:
- ❌ Can be screenshot and shared
- ❌ Can be forwarded to others
- ❌ Can be used by wrong person

### PIN Adds Security:
- ✓ Passenger must verbally provide PIN
- ✓ Screenshot doesn't help without PIN
- ✓ Driver confirms correct passenger
- ✓ Two-factor verification

---

## Testing Guide

### Test Scenario 1: Happy Path

**1. Admin Login**
```bash
curl -X POST http://localhost:4000/api2/auth/login \
-H "Content-Type: application/json" \
-d '{
    "email": "admin@example.com",
    "password": "password123"
}'
```

**Expected Response:**
```json
{
    "success": true,
    "message": "Login successful",
    "data": {
        "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
}
```

**2. Create Booking**
```bash
curl -X POST http://localhost:4000/api2/bookings \
-H "Content-Type: application/json" \
-H "Authorization: Bearer {accessToken}" \
-d '{
    "trip_id": 1,
    "passenger_id": 42,
    "passenger_name": "Test User",
    "passenger_mobile": "9876543210",
    "passenger_email": "test@example.com",
    "origin_stop_id": 1,
    "destination_stop_id": 2,
    "travel_date": "2026-10-01",
    "seat_numbers": ["1A"],
    "total_seats": 1,
    "payment_method": "cash"
}'
```

**Expected Response:**
```json
{
    "success": true,
    "message": "Booking confirmed",
    "data": {
        "booking_id": 100,
        "boarding_pass_code": "BP-8F72K9M4",
        "boarding_pin": "4821"
    }
}
```

**3. Driver Login**
```bash
curl -X POST http://localhost:4000/api2/bus-driver/auth/login-otp \
-H "Content-Type: application/json" \
-d '{
    "mobile": "9876543210"
}'
```

**Expected Response:**
```json
{
    "status": 200,
    "success": true,
    "message": "OTP sent successfully",
    "data": {
        "otp_demo": "1234"
    }
}
```

**4. Verify OTP**
```bash
curl -X POST http://localhost:4000/api2/bus-driver/auth/verify-otp \
-H "Content-Type: application/json" \
-d '{
    "mobile": "9876543210",
    "otp": "1234"
}'
```

**Expected Response:**
```json
{
    "status": 200,
    "success": true,
    "message": "Login successful",
    "data": {
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
}
```

**5. Scan Boarding Pass**
```bash
curl -X POST http://localhost:4000/api2/bus-driver/scan-boarding-pass \
-H "Content-Type: application/json" \
-H "Authorization: Bearer {driverToken}" \
-d '{
    "trip_id": 1,
    "boarding_pass_code": "BP-8F72K9M4"
}'
```

**Expected Response:**
```json
{
    "status": 200,
    "success": true,
    "message": "Boarding pass verified successfully",
    "data": {
        "booking_id": 100,
        "passenger_name": "Test User",
        "boarding_pin_required": true
    }
}
```

**6. Confirm Boarding**
```bash
curl -X POST http://localhost:4000/api2/bus-driver/confirm-boarding \
-H "Content-Type: application/json" \
-H "Authorization: Bearer {driverToken}" \
-d '{
    "booking_id": 100,
    "boarding_pin": "4821"
}'
```

**Expected Response:**
```json
{
    "status": 200,
    "success": true,
    "message": "Passenger boarding confirmed successfully",
    "data": {
        "boarding_status": "boarded"
    }
}
```

### Test Scenario 2: Invalid QR Code

```bash
curl -X POST http://localhost:4000/api2/bus-driver/scan-boarding-pass \
-H "Content-Type: application/json" \
-H "Authorization: Bearer {driverToken}" \
-d '{
    "trip_id": 1,
    "boarding_pass_code": "BP-INVALID"
}'
```

**Expected Response:**
```json
{
    "status": 404,
    "success": false,
    "message": "Invalid boarding pass code. Ticket not found."
}
```

### Test Scenario 3: Wrong PIN

```bash
curl -X POST http://localhost:4000/api2/bus-driver/confirm-boarding \
-H "Content-Type: application/json" \
-H "Authorization: Bearer {driverToken}" \
-d '{
    "booking_id": 100,
    "boarding_pin": "0000"
}'
```

**Expected Response:**
```json
{
    "status": 400,
    "success": false,
    "message": "Invalid boarding PIN code entered"
}
```

### Test Scenario 4: Already Boarded

Try scanning the same QR twice:

```bash
# Second scan attempt
curl -X POST http://localhost:4000/api2/bus-driver/scan-boarding-pass \
-H "Content-Type: application/json" \
-H "Authorization: Bearer {driverToken}" \
-d '{
    "trip_id": 1,
    "boarding_pass_code": "BP-8F72K9M4"
}'
```

**Expected Response:**
```json
{
    "status": 400,
    "success": false,
    "message": "Passenger has already boarded this bus",
    "data": {
        "booking_id": 100,
        "passenger_name": "Test User",
        "seat_numbers": ["1A"],
        "boarded_at": "2026-10-01T05:52:30.000Z"
    }
}
```

---

## Implementation Status

### ✅ Already Implemented

**Database Schema:**
- [x] Booking model with boarding fields (boarding_pass_code, boarding_pin, boarding_time, boarded_at, boarding_status)
- [x] Trip model with driver and vehicle assignment
- [x] BusDriverAssignment model for assignment workflow
- [x] Route, Stop, Vehicle, BusType models

**Booking APIs:**
- [x] POST /api2/bookings - Create booking with QR + PIN generation
- [x] GET /api2/bookings - List bookings
- [x] GET /api2/bookings/:id - Get booking details
- [x] PATCH /api2/bookings/:id/cancel - Cancel booking
- [x] PATCH /api2/bookings/:id/payment - Update payment

**Driver Authentication:**
- [x] POST /api2/bus-driver/auth/login-otp - Send OTP
- [x] POST /api2/bus-driver/auth/verify-otp - Verify OTP & authenticate
- [x] GET /api2/bus-driver/profile - Get profile
- [x] PUT /api2/bus-driver/profile - Update profile
- [x] PATCH /api2/bus-driver/duty-status - Toggle duty status

**Driver Assignment APIs:**
- [x] POST /api2/bus-driver/available-schedules - Get available schedules
- [x] POST /api2/bus-driver/accept-assignment - Accept assignment
- [x] POST /api2/bus-driver/my-assignments - Get my assignments
- [x] POST /api2/bus-driver/assignments/:id/start - Start assignment
- [x] POST /api2/bus-driver/assignments/:id/complete - Complete assignment
- [x] POST /api2/bus-driver/assignments/:id/cancel - Cancel assignment

**Driver Trip APIs:**
- [x] GET /api2/bus-driver/assigned-trips - Get assigned trips
- [x] GET /api2/bus-driver/trips/:id - Get trip details
- [x] GET /api2/bus-driver/trips/:id/manifest - Get passenger manifest
- [x] POST /api2/bus-driver/trips/:id/start - Start trip
- [x] POST /api2/bus-driver/trips/:id/complete - Complete trip

**Boarding Verification APIs:**
- [x] POST /api2/bus-driver/scan-boarding-pass - Scan boarding pass
- [x] POST /api2/bus-driver/confirm-boarding - Confirm boarding
- [x] POST /api2/bus-driver/manual-verify-boarding - Manual verify boarding

**Other APIs:**
- [x] POST /api2/bus-driver/location/update - Update GPS location
- [x] GET /api2/bus-driver/history - Trip history
- [x] GET /api2/bus-driver/earnings - Earnings summary
- [x] GET /api2/routes - List routes
- [x] GET /api2/trips - List trips
- [x] GET /api2/vehicles - List vehicles
- [x] GET /api2/passengers - List passengers

### ✅ User-Facing Public APIs (Now Implemented)

**Bus & Route APIs:**
- [x] POST /api2/bus/types - Get bus types
- [x] POST /api2/bus/routes - Get routes
- [x] POST /api2/bus/search-routes - Search routes with filters
- [x] POST /api2/bus/schedules - Get schedules
- [x] POST /api2/bus/seat-availability - Check seat availability
- [x] POST /api2/bus/calculate-fare - Calculate fare

**Booking APIs:**
- [x] POST /api2/bus/user-bookings - Get user's bookings
- [x] POST /api2/bus/booking-details - Get booking details for boarding pass
- [x] POST /api2/bus/cancel-booking - Cancel user booking

### 🔄 Optional Enhancements (Not Implemented)

The following features from Laravel are not yet implemented in Node.js but can be added if needed:

**Additional Features:**
- [ ] Send SMS/email with boarding pass details
- [ ] Add boarding history to driver dashboard
- [ ] Add passenger count to trip summary
- [ ] QR code generation endpoint
- [ ] Boarding pass download endpoint

---

## File Structure

### Controllers
- `controllers/authController.js` - Admin authentication
- `controllers/bookingController.js` - Booking management with SeatReservationService seat conflict validation
- `controllers/busController.js` - User-facing bus APIs (types, routes, search-routes, search-stops, schedules, seat availability)
- `controllers/driverAppController.js` - Driver app APIs (home dashboard, current stop, arrive, passenger manifest, QR scan & PIN confirm boarding)
- `controllers/busDriverAssignmentController.js` - Driver assignment workflow
- `controllers/tripController.js` - Trip management
- `controllers/routeController.js` - Route management (CRUD, duplicate, reverse)
- `controllers/stopController.js` - Reusable master physical stops management
- `controllers/passengerController.js` - Passenger management

### Services
- `services/busRouteSearchService.js` - Cityflo-style location-first search algorithm, stop sequence validation, dynamic available dates, fallback schedule generation
- `services/busStopSearchService.js` - Stop candidate resolution, alias matching, Haversine distance, walking vs driving formatting
- `services/seatReservationService.js` - Per-trip seat conflict validation & HTTP 409 SEAT_ALREADY_BOOKED enforcement

### Models
- `models/Booking.js` - Booking model with boarding fields (`boarding_pass_code`, `boarding_pin`, `boarding_status`, `qr_token`)
- `models/Trip.js` - Trip model
- `models/BusDriverAssignment.js` - Driver assignment model
- `models/Route.js` - Route model
- `models/RouteStop.js` - Junction table connecting routes to master physical stops with stop sequence and pickup/dropoff allowances
- `models/Stop.js` - Master physical stop model
- `models/Vehicle.js` - Vehicle model
- `models/BusType.js` - Bus type model
- `models/Driver.js` - Driver model
- `models/Passenger.js` - Passenger model

### Routes
- `routes/authRoutes.js` - Admin authentication routes
- `routes/bookingRoutes.js` - Booking routes
- `routes/busRoutes.js` - User-facing bus routes (public APIs: search-routes, search-stops, schedules, seat-availability)
- `routes/driverAppRoutes.js` - Driver app routes (auth, duty status, trips, stops, QR scan, PIN confirm boarding, location update)
- `routes/tripRoutes.js` - Trip routes
- `routes/routeRoutes.js` - Route & physical stop master routes

### Middleware
- `middleware/auth.js` - Admin authentication middleware
- `middleware/driverAuth.js` - Driver authentication middleware
- `middleware/auditLog.js` - Audit logging
- `middleware/errorHandler.js` - Error handling

---

## Next Steps

1. **Test All APIs:**
   - Use Postman or curl to test all endpoints
   - Verify boarding verification flow works correctly
   - Test user-facing public APIs (bus types, routes, schedules, seat availability, fare calculation)

2. **Update Mobile Apps:**
   - User app: Show QR + PIN after booking
   - User app: Integrate with new public APIs for booking flow
   - Driver app: Add QR scanner + PIN entry (already exists)

3. **Deploy to Production:**
   - Set up environment variables
   - Configure database migrations
   - Set up SSL/TLS
   - Configure rate limiting
   - Add authentication middleware to user-facing APIs if needed

---

## Support

For any issues or questions, refer to:
- Main documentation: `BUS_BOARDING_VERIFICATION_API.md` (Laravel version)
- API testing: Use Postman collection
- Database: Check model definitions in `models/` directory
- Server: Start with `npm run dev` for development

---

## API Base URL

**Development:** `http://localhost:4000/api2`
**Production:** `https://your-domain.com/api2`

---

## Authentication

### Admin Authentication
- Use JWT tokens from `/api2/auth/login`
- Include in header: `Authorization: Bearer {accessToken}`
- Refresh tokens using `/api2/auth/refresh-token`

### Driver Authentication
- Use OTP-based authentication
- Send OTP via `/api2/bus-driver/auth/login-otp`
- Verify OTP via `/api2/bus-driver/auth/verify-otp`
- Include in header: `Authorization: Bearer {driverToken}`

---

## Error Handling

All APIs return consistent error responses:

```json
{
    "success": false,
    "message": "Error message here"
}
```

Or with status code:

```json
{
    "status": 400,
    "success": false,
    "message": "Error message here"
}
```

Common HTTP status codes:
- 200: Success
- 201: Created
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 409: Conflict
- 500: Internal Server Error
