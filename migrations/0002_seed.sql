-- Seed data so production isn't empty on first deploy.
-- Mirrors the current hardcoded demo deals and default siteSettings
-- from index.html so behaviour is identical right after cutover.

INSERT INTO deals (flag, route, dates, price, badge, url, expiry, slug, region) VALUES
  ('🇪🇸', 'Dublin → Ibiza',     'Late April – May · Return', '€47',  '🔥 Hot',        'https://www.ryanair.com/ie/en/cheap-flights/dublin/ibiza',     date('now', '+7 days'),  'dublin-ibiza-47',     'ie'),
  ('🇵🇹', 'Dublin → Lisbon',    'June Weekends · Return',    '€29',  '⚡ Flash',      'https://www.ryanair.com/ie/en/cheap-flights/dublin/lisbon',    date('now', '+3 days'),  'dublin-lisbon-29',     'ie'),
  ('🇺🇸', 'Dublin → New York',  'October – Nov · Return',    '€289', '✈ Long Haul',  'https://www.aerlingus.com/flights/dublin/new-york',            date('now', '+14 days'), 'dublin-new-york-289', 'ie'),
  ('🇮🇹', 'Dublin → Rome',      'September · Return',        '€52',  '⭐ Featured',   'https://www.ryanair.com/ie/en/cheap-flights/dublin/rome',      date('now', '+7 days'),  'dublin-rome-52',      'ie');

-- Bootstrap admin login so it keeps working through cutover. This is a hash
-- of the CURRENT default password ('mrcheap2024'), which has been sitting in
-- plaintext in the live page source — treat it as already compromised.
-- Change it immediately after first login via Settings -> Security.
INSERT INTO admin_auth (id, password_hash, password_salt) VALUES
  (1, 'e3d930fb434e83920cf6df5a8828eb8b115f8f2561a569b1d1ed22bae4e285d7', '231d4d040f04d9f864aaaecce6219194');

INSERT INTO settings (key, value) VALUES
  ('members', '12,400+'),
  ('monthly', '47'),
  ('saving', '€183'),
  ('waNumber', ''),
  ('mailchimp', ''),
  ('igUrl', 'https://instagram.com/mrcheapflights'),
  ('tkUrl', '#'),
  ('fbUrl', '#'),
  ('twUrl', '#'),
  ('contactEmail', 'hello@mrcheapflights.ie'),
  ('stripePk', ''),
  ('stripePriceMonthly', ''),
  ('stripePriceAnnual', '');
