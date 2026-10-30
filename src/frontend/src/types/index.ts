/* ───────────────────────────────────────────────
   TypeScript types mirroring the fix_oncab SQL schema
   ─────────────────────────────────────────────── */

// ── bus_routes ──
export interface BusRoute {
  id: number;
  route_name: string;
  route_code: string;
  origin_city: string;
  destination_city: string;
  route_stops: any | null;
  total_distance: number;
  estimated_duration: number; // minutes
  status: 'Active' | 'Inactive';
  description: string | null;
  created_at: string | null;
  updated_at: string | null;
}

// ── bus_stops ──
export interface BusStop {
  id: number;
  route_id: number;
  stop_name: string;
  latitude: number;
  longitude: number;
  stop_sequence: number;
  stop_code: string;
  address: string | null;
  landmark: string | null;
  status: 'Active' | 'Inactive';
  created_at: string | null;
  updated_at: string | null;
}

// ── bus_types ──
export interface BusType {
  id: number;
  name: string;
  code: string;
  total_seats: number;
  seat_rows: number;
  seat_columns: number;
  seat_type: 'seater' | 'sleeper' | 'semi-sleeper';
  has_ac: boolean;
  has_wifi: boolean;
  status: 'Active' | 'Inactive';
  description: string | null;
  amenities: any | null;
  image: string | null;
  created_at: string | null;
  updated_at: string | null;
}

// ── bus_schedules ──
export interface BusSchedule {
  id: number;
  route_id: number;
  bus_type_id: number;
  schedule_code: string;
  bus_number: string;
  departure_time: string;
  arrival_time: string;
  operating_days: string;
  base_fare: number;
  fare_per_km: number;
  status: 'Active' | 'Inactive' | 'Cancelled';
  valid_from: string | null;
  valid_until: string | null;
  driver_id: number | null;
  car_id: number | null;
  trip_date: string | null;
  seat_capacity: number;
  booked_seats: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  // joined
  route?: BusRoute;
  bus_type?: BusType;
  driver?: Driver;
  car?: CarDetail;
}

// ── bus_bookings ──
export interface BusBooking {
  id: number;
  booking_reference: string;
  user_id: number;
  schedule_id: number;
  origin_stop_id: number;
  destination_stop_id: number;
  travel_date: string;
  seat_numbers: any;
  total_seats: number;
  total_fare: number;
  discount_amount: number;
  final_amount: number;
  passenger_name: string;
  passenger_mobile: string;
  passenger_email: string | null;
  payment_status: 'pending' | 'paid' | 'failed' | 'refunded';
  payment_method: string | null;
  transaction_id: string | null;
  booking_status: 'confirmed' | 'cancelled' | 'completed';
  boarding_pass_code: string;
  boarding_pin: string | null;
  boarding_time: string | null;
  boarded_at: string | null;
  boarding_status: 'not_boarded' | 'boarded';
  special_requests: string | null;
  qr_token: string | null;
  dropped_at: string | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  // joined
  schedule?: BusSchedule;
  origin_stop?: BusStop;
  destination_stop?: BusStop;
  user?: User;
}

// ── bus_booking_events ──
export interface BusBookingEvent {
  id: number;
  booking_id: number;
  event: string;
  performed_by: number | null;
  performed_by_type: string | null;
  metadata: any | null;
  created_at: string | null;
  updated_at: string | null;
}

// ── bus_trip_stops ──
export interface BusTripStop {
  id: number;
  schedule_id: number;
  stop_id: number;
  stop_order: number;
  scheduled_arrival: string | null;
  actual_arrival: string | null;
  departed_at: string | null;
  status: string;
  expected_pickups: number;
  boarded_count: number;
  drop_count: number;
  created_at: string | null;
  updated_at: string | null;
  stop?: BusStop;
}

// ── bus_driver_assignments ──
export interface BusDriverAssignment {
  id: number;
  schedule_id: number;
  driver_id: number;
  assignment_date: string;
  reporting_time: string;
  status: 'assigned' | 'started' | 'completed' | 'cancelled';
  start_odometer: number | null;
  end_odometer: number | null;
  notes: string | null;
  car_id: number | null;
  created_at: string | null;
  updated_at: string | null;
}

// ── drivers ──
export interface Driver {
  id: number;
  city_id: number | null;
  zone_id: number | null;
  driver_type_id: number | null;
  vehicle_type_id: number | null;
  name: string;
  email: string | null;
  mobile: string | null;
  aadhar: string | null;
  pan: string | null;
  driver_user_id: string | null;
  address: string | null;
  sex: 'Male' | 'Female' | null;
  device_id: string | null;
  photo: string | null;
  referral: string | null;
  created_by: string | null;
  block_status: 'Block' | 'Unblock' | null;
  complete_status: 'Complete' | 'Incomplete' | null;
  online_status: 'Online' | 'Offline' | null;
  status: 'Approve' | 'Disapprove' | 'Reject' | null;
  created_at: string | null;
  updated_at: string | null;
  // joined
  details?: DriverDetail;
  bank_account?: DriverBankAccount;
}

// ── driver_details ──
export interface DriverDetail {
  id: number;
  user_id: number | null;
  birth_day: string | null;
  latitude: string | null;
  longitude: string | null;
  address: string | null;
  aadhar: string | null;
  aadhar_img: string | null;
  aadhar_back_img: string | null;
  driving_licence: string | null;
  driving_licence_img: string | null;
  driving_licence_back_img: string | null;
  licence_expiry_date: string | null;
  driver_authorized_letter_img: string | null;
  smart_card_number: string | null;
  smart_card_img: string | null;
  smart_card_back_img: string | null;
  emergency_contact_number: string | null;
  father_name: string | null;
  mother_name: string | null;
  blood_group: string | null;
  alternate_mobile: string | null;
  availability_status: 'Yes' | 'No' | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
}

// ── driver_bank_accounts ──
export interface DriverBankAccount {
  id: number;
  user_id: number;
  account_holder_name: string;
  bank_name: string | null;
  account_number: string | null;
  ifsc_code: string | null;
  branch_name: string | null;
  upi_id: string | null;
  account_type: 'Bank' | 'UPI';
  status: 'Active' | 'Inactive';
  edit_status: 'Edit Requested' | 'Edit Approved' | 'Details Pending' | null;
  created_at: string | null;
  updated_at: string | null;
}

// ── car_details (vehicles) ──
export interface CarDetail {
  id: number;
  user_id: number | null;
  vehicle_type_id: number | null;
  car_type_id: number | null;
  company_id: number | null;
  company_other: string | null;
  company_model: string | null;
  company_model_other: string | null;
  blue_book_number: string | null;
  blue_book_img: string | null;
  blue_book_back_img: string | null;
  rc_certificate_img: string | null;
  car_number: string | null;
  car_img: string | null;
  car_fitness_img: string | null;
  car_fitness_expired: string | null;
  car_engine_number: string | null;
  car_chassis_number: string | null;
  garage_address: string | null;
  latitude: string | null;
  longitude: string | null;
  insurance_number: string | null;
  insurance_img: string | null;
  engine_type: string | null;
  pollution_certificate: string | null;
  pollution_expired_date: string | null;
  car_expired_date: string | null;
  car_purchase_date: string | null;
  car_color: string | null;
  created_at: string | null;
  updated_at: string | null;
  // joined
  owner?: Driver;
}

// ── vehicle_types ──
export interface VehicleType {
  id: number;
  name: string | null;
  slug: string | null;
  status: 'Active' | 'Inactive' | null;
  img: string | null;
  radius: number | null;
  created_at: string | null;
  updated_at: string | null;
}

// ── coupons (passes) ──
export interface Coupon {
  id: number;
  user_id: number | null;
  code: string | null;
  amount: string | null;
  code_type: 'FLAT' | 'PERCENTAGE' | null;
  min_amount: string | null;
  max_discount: string | null;
  start_date: string | null;
  end_date: string | null;
  number_of_coupon: string | null;
  desc: string | null;
  user_type: 'All' | 'User' | 'Driver' | null;
  status: 'Active' | 'Inactive' | null;
  created_at: string | null;
  updated_at: string | null;
}

// ── notifications ──
export interface Notification {
  id: string;
  type: string;
  notifiable_type: string;
  notifiable_id: number;
  data: string;
  read_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

// ── payments_transaction ──
export interface PaymentTransaction {
  id: number;
  payment_gateway: string | null;
  payu_txnid: string | null;
  payu_mihpayid: string | null;
  razorpay_payment_id?: string | null;
  razorpay_order_id?: string | null;
  razorpay_signature?: string | null;
  amount: number;
  currency: string;
  status: string;
  event: string | null;
  payload: any | null;
  created_at: string | null;
  updated_at: string | null;
}

// ── users ──
export interface User {
  id: number;
  city_id: number | null;
  zone_id: number | null;
  name: string | null;
  email: string | null;
  mobile: string | null;
  aadhar: string | null;
  pan: string | null;
  address: string | null;
  referral: string | null;
  sex: 'Male' | 'Female' | null;
  photo: string | null;
  block_status: 'Block' | 'Unblock' | null;
  online_status: 'Online' | 'Offline' | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
}

// ── banners ──
export interface Banner {
  id: number;
  title: string;
  subtitle: string | null;
  banner_type: 'image' | 'video';
  media_url: string;
  media_full_url?: string;
  thumbnail_url: string | null;
  thumbnail_full_url?: string;
  video_type?: 'file' | 'youtube' | 'vimeo' | 'external_url';
  cta_title: string | null;
  cta_url: string | null;
  position: string;
  display_order: number;
  is_active: boolean;
  start_date: string | null;
  end_date: string | null;
  autoplay: boolean;
  is_muted: boolean;
  loop_video: boolean;
  show_controls: boolean;
  click_count: number;
  view_count: number;
  created_by?: number | null;
  created_at: string | null;
  updated_at: string | null;
}

// ── ride_packages (City Flow -> Ride Pack) ──
export interface RidePackage {
  id: number;
  package_code: string;
  name: string;
  package_type: 'single_trip' | 'fixed_bundle' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';
  rides_count: number;
  validity_days: number;
  price_per_ride: number;
  total_price: number;
  original_price?: number | null;
  discount_percentage?: number;
  route_id?: number | null;
  description?: string | null;
  features?: string[] | null;
  badge_text?: string | null;
  is_popular?: boolean;
  status: 'Active' | 'Inactive';
  savings_amount?: number;
  formatted_price?: string;
  formatted_per_ride?: string;
  created_at?: string;
  updated_at?: string;
}

// ── View type for navigation ──
export type View =
  | 'dashboard'
  | 'users'
  | 'roles'
  | 'drivers'
  | 'vehicles'
  | 'vehicle-docs'
  | 'routes'
  | 'stops'
  | 'trips'
  | 'scheduled-trips'
  | 'cross-connection'
  | 'locations'
  | 'driver-location-history'
  | 'rate-charts'
  | 'packages'
  | 'package-purchases'
  | 'passengers'
  | 'bookings'
  | 'passes'
  | 'cancelled-tickets'
  | 'refunds'
  | 'failed-refunds'
  | 'paid-refunds'
  | 'payments'
  | 'notifications'
  | 'coupons'
  | 'reports'
  | 'owner-weekly-payment-report'
  | 'owner-payout-rates'
  | 'audit-logs'
  | 'settings'
  | 'owner-requests'
  | 'banners'
  | 'payu-webhooks'
  | 'owner-kyc'
  | 'owner-settlements';
