-- CreateIndex
CREATE INDEX "idx_loan_transactions_borrow_date" ON "loan_transactions"("borrow_date");

-- CreateIndex
CREATE INDEX "idx_loan_items_due_return" ON "loan_items"("due_date", "return_date");
