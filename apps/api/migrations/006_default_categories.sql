INSERT INTO categories(name) VALUES
('Engine'),('Fuel System'),('Cooling System'),('Clutch'),('Gearbox'),('Propeller Shaft'),
('Differential'),('Front Axle'),('Rear Axle'),('Brake System'),('Suspension'),('Steering'),
('Electrical'),('Battery'),('Lighting'),('Cabin / Body'),('Filters'),('Belts'),('Bearings'),
('Lubricants'),('Tyres'),('Fasteners'),('Service Kits'),('Consumables')
ON CONFLICT(name) DO NOTHING;
