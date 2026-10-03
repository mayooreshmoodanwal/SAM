CREATE TABLE vehicle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL REFERENCES customer_vehicles(id),
  type text NOT NULL CHECK (type IN ('SERVICE_VISIT','NOTE','REPLACEMENT')),
  description text NOT NULL, odometer integer CHECK (odometer>=0),
  created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vehicle_events_vehicle_time_idx ON vehicle_events(vehicle_id,created_at DESC);
CREATE TRIGGER vehicle_events_immutable BEFORE UPDATE OR DELETE ON vehicle_events FOR EACH ROW EXECUTE FUNCTION reject_history_change();
