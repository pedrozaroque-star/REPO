-- Check user details for login debugging
SELECT id, email, password, role, is_active, store_scope, store_id
FROM users
WHERE email = 'cruz@tacosgavilan.com';
