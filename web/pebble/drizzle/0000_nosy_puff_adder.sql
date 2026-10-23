CREATE TABLE `send_gate` (
	`key` text PRIMARY KEY NOT NULL,
	`next_at` integer DEFAULT 0 NOT NULL
);
