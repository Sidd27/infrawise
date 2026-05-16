ALTER USER 'demo'@'%' IDENTIFIED WITH mysql_native_password BY 'demo';
CREATE USER IF NOT EXISTS 'demo'@'localhost' IDENTIFIED WITH mysql_native_password BY 'demo';
GRANT ALL PRIVILEGES ON `demodb`.* TO 'demo'@'localhost';
FLUSH PRIVILEGES;
