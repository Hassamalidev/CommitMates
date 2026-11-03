CREATE INDEX "university_requests_university_idx" ON "university_requests" USING btree ("university_id");--> statement-breakpoint
CREATE INDEX "university_requests_reviewed_by_idx" ON "university_requests" USING btree ("reviewed_by");--> statement-breakpoint
CREATE INDEX "vouches_university_idx" ON "vouches" USING btree ("university_id");--> statement-breakpoint
CREATE INDEX "departments_created_by_idx" ON "departments" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "departments_merged_into_idx" ON "departments" USING btree ("merged_into_id");--> statement-breakpoint
CREATE INDEX "invites_created_by_idx" ON "invites" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "gh_repos_topics_idx" ON "gh_repos" USING gin ("topics");--> statement-breakpoint
CREATE INDEX "reports_target_message_idx" ON "reports" USING btree ("target_message");--> statement-breakpoint
CREATE INDEX "reports_resolved_by_idx" ON "reports" USING btree ("resolved_by");--> statement-breakpoint
CREATE INDEX "swap_proposals_university_idx" ON "swap_proposals" USING btree ("university_id");