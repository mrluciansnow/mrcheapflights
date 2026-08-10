-- Branded social ad poster (1080×1080 canvas composite: flux background +
-- gradient + price/route/dates + flag + mascot + wordmark), generated in the
-- pipeline and preferred over the raw photo when posting to social.
ALTER TABLE deals ADD COLUMN poster_url TEXT;
