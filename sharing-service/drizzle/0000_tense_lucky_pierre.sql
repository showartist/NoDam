CREATE TABLE `live_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`snapshot` text NOT NULL,
	`updated_at` text NOT NULL
);
