-- DATA-DRIVEN EVENT MULTIPLIERS FOR 2026
-- Based on 2025 vs Control Week Analysis
-- Normalized for Day of Week impact

DELETE FROM calendar_events WHERE date >= '2026-01-01';

INSERT INTO calendar_events (name, date, impact_multiplier) VALUES
    ('Super Bowl LX (Domingo)', '2026-02-08', 0.85), -- Lower than regular Sunday in 2025
    ('San Valentin (Sabado)',   '2026-02-14', 1.05), -- Slight bump
    ('St Patricks (Martes)',    '2026-03-17', 1.00), -- Neutral
    ('Memorial Day (Lunes)',    '2026-05-25', 1.15), -- Strong Monday
    ('Cinco de Mayo (Martes)',  '2026-05-05', 1.24), -- Strong bump
    ('Dia de las Madres (Dom)', '2026-05-10', 0.93), -- Slightly lower than regular Sunday?
    ('Dia del Padre (Domingo)', '2026-06-21', 0.88), -- Lower than regular Sunday
    ('July 4th (Sabado)',       '2026-07-04', 0.80), -- 20% Drop (Fireworks/BBQ effect)
    ('Labor Day (Lunes)',       '2026-09-07', 1.19), -- Strong Monday
    ('Halloween (Sabado)',      '2026-10-31', 1.17); -- Strong bump (Saturday Halloween)
