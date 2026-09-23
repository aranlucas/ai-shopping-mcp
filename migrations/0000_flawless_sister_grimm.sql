CREATE TABLE `equipment_items` (
	`user_id` text NOT NULL,
	`name_key` text NOT NULL,
	`equipment_name` text NOT NULL,
	`category` text,
	`added_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `name_key`)
);
--> statement-breakpoint
CREATE TABLE `order_history` (
	`id` text NOT NULL,
	`user_id` text NOT NULL,
	`record_json` text NOT NULL,
	`placed_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `order_history_user_placed` ON `order_history` (`user_id`,`placed_at`);--> statement-breakpoint
CREATE TABLE `pantry_items` (
	`user_id` text NOT NULL,
	`name_key` text NOT NULL,
	`product_name` text NOT NULL,
	`quantity` real NOT NULL,
	`added_at` text NOT NULL,
	`expires_at` text,
	PRIMARY KEY(`user_id`, `name_key`)
);
--> statement-breakpoint
CREATE TABLE `preferred_stores` (
	`user_id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`location_name` text NOT NULL,
	`address` text NOT NULL,
	`chain` text NOT NULL,
	`set_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shopping_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`items_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shopping_lists_user_updated` ON `shopping_lists` (`user_id`,`updated_at`);