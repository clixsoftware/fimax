# -*- coding: utf-8 -*-
# Copyright (c) 2017, Yefri Tavarez and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
from frappe.model.document import Document

from fimax.api import rate_to_decimal as dec
from fimax.api import create_loan_from_appl

from fimax import simple
from fimax import compound

from frappe.utils import flt, cint, cstr
from frappe import _ as __

class Loan(Document):
	def validate(self):
		loan_schedule_ids = [row.name.split()[0] 
			for row in self.loan_schedule]
			
		if __("New") in loan_schedule_ids:
			self.set_missing_values()

		self.update_repayment_schedule_dates()
		self.validate_company()
		self.validate_currency()
		self.validate_party_account()
		self.validate_exchange_rate()

	def before_insert(self):
		if not self.loan_application:
			frappe.throw(__("Missing Loan Application!"))

		self.validate_loan_application()

	def after_insert(self):
		pass

	def before_submit(self):
		pass

	def on_submit(self):
		self.make_gl_entries(cancel=False)
		self.commit_to_loan_charges()

	def before_cancel(self):
		self.make_gl_entries(cancel=True)
		self.rollback_from_loan_charges()

	def on_cancel(self):
		pass

	def on_trash(self):
		pass

	def make_loan(self):
		if self.loan_application:
			loan_appl = frappe.get_doc(self.meta.get_field("loan_application").options, 
				self.loan_application)

			self.evaluate_loan_application(loan_appl)

			return create_loan_from_appl(loan_appl)

	def set_missing_values(self):
		# simple or compound variable
		soc = simple
	
		if self.interest_type == "Compound":
			soc = compound

		self.total_capital_amount = self.loan_amount

		self.repayment_amount = soc.get_repayment_amount(self.total_capital_amount, 
			dec(self.interest_rate), self.repayment_periods)

		self.total_interest_amount = soc.get_total_interest_amount(self.total_capital_amount,
			dec(self.interest_rate), self.repayment_periods)

		self.total_payable_amount = soc.get_total_payable_amount(self.total_capital_amount,
			dec(self.interest_rate), self.repayment_periods)

		# empty the table to avoid duplicated rows
		self.set("loan_schedule", [])

		for row in soc.get_as_array(self.total_capital_amount,
			dec(self.interest_rate), self.repayment_periods):

			repayment_date = frappe.utils.add_months(self.posting_date, row.idx)

			self.append("loan_schedule", row.update({
				"status": "Pending",
				"repayment_date": self.get_correct_date(repayment_date),
				"outstanding_amount": row.repayment_amount,
				"paid_amount": 0.000
			}))

		self.set_accounts()
		self.set_company_currency()
		self.tryto_get_exchange_rate()

	def set_accounts(self):
		self.set_party_account()
		self.income_account = frappe.get_value("Company", self.company, "default_income_account")
		self.disbursement_account = frappe.get_value("Company", self.company, "default_bank_account")
		
	def get_correct_date(self, repayment_date):
		last_day_of_the_month = frappe.utils.get_last_day(repayment_date)
		first_day_of_the_month = frappe.utils.get_first_day(repayment_date)

		if cint(self.repayment_day_of_the_month) > last_day_of_the_month.day:
			return last_day_of_the_month.replace(last_day_of_the_month.year, 
				last_day_of_the_month.month, last_day_of_the_month.day)
		else:
			return frappe.utils.add_days(first_day_of_the_month, 
				cint(self.repayment_day_of_the_month) - 1)

	def set_party_account(self):
		from erpnext.accounts.party import get_party_account

		if self.party_type in ("Customer", "Supplier"):
			self.party_account = get_party_account(self.party_type, self.party, self.company)
		else:
			default_receivable = frappe.get_value("Company", self.company, "default_receivable_account")

			first_receivable = frappe.get_value("Account", {
				"account_type": "Receivable",
				"company": self.company,
				"account_currency": self.currency
			})

			self.party_account =  default_receivable or first_receivable

	def set_company_currency(self):
		default_currency = frappe.get_value("Company", self.company, "default_currency")
		self.company_currency = default_currency

	def tryto_get_exchange_rate(self):
		if not self.exchange_rate == 1.000:	return

		# the idea is to get the filters in the two possible combinations
		# ex.
		# 1st => { u'from_currency': u'USD', u'to_currency': u'INR' }
		# 2nd => { u'from_currency': u'INR', u'to_currency': u'USD' }

		field_list = ["from_currency", "to_currency"]
		currency_list = [self.currency, self.company_currency]

		purchase_bank_rate = frappe.get_value("Currency Exchange", 
			dict(zip(field_list, currency_list)), "exchange_rate", order_by="date DESC")

		# reverse the second list to get the second combination
		currency_list.reverse()

		sales_bank_rate = frappe.get_value("Currency Exchange", 
			dict(zip(field_list, currency_list)), "exchange_rate", order_by="date DESC")

		self.exchange_rate = purchase_bank_rate or sales_bank_rate or 1.000

	def update_repayment_schedule_dates(self):
		for row in self.loan_schedule:
			row.repayment_date = self.get_correct_date(row.repayment_date) 

	def validate_currency(self):
		if not self.currency:
			frappe.throw(__("Currency for Loan is mandatory!"))
		
	def validate_company(self):
		if not self.company:
			frappe.throw(__("Company for Loan is mandatory!"))

	def validate_party_account(self):
		if not self.party_account:
			frappe.throw(__("Party Account for Loan is mandatory!"))
			
		company, account_type, currency = frappe.get_value("Account",
			self.party_account, ["company", "account_type", "account_currency"])

		if not company == self.company:
			frappe.throw(__("Selected party account does not belong to Loan's Company!"))

		if not account_type == "Receivable":
			frappe.throw(__("Selected party account is not Receivable!"))

		if not currency == self.currency:
			frappe.throw(__("Selected party account currency does not match with the Loan's Currency!"))

	def validate_exchange_rate(self):
		if not self.exchange_rate:
			frappe.throw(__("Unexpected exchange rate"))

	def validate_loan_application(self):
		if self.loan_application:
			loan_appl = frappe.get_doc(self.meta.get_field("loan_application").options, 
				self.loan_application)

			self.evaluate_loan_application(loan_appl)

	def evaluate_loan_application(self, loan_appl):
		if loan_appl.docstatus == 0:
			frappe.throw(__("Submit this Loan Application first!"))

		elif loan_appl.docstatus == 2:
			frappe.throw(__("The selected Loan Application is already cancelled!"))

		if frappe.db.exists("Loan", { 
			"loan_application": loan_appl.name ,
			"docstatus": ["!=", "2"]
		}):
			frappe.throw(__("The selected Loan Application already has a Loan document attached to it!"))

	def get_lent_amount(self):
		return flt(self.loan_amount) - flt(self.legal_expenses_amount)

	def commit_to_loan_charges(self):
		from fimax.install import add_default_loan_charges_type
		
		# run this to make sure default loan charges type are set
		add_default_loan_charges_type()

		for row in self.loan_schedule:
			capital_loan_charge = row.get_new_loan_charge("Capital", row.capital_amount)
			capital_loan_charge.submit()

			interest_loan_charge = row.get_new_loan_charge("Interest", row.interest_amount)
			interest_loan_charge.submit()

	def rollback_from_loan_charges(self):
		for row in self.loan_schedule:
			[self.cancel_and_delete_loan_charge(row, lct) 
				for lct in ('Capital', 'Interest')]

	def cancel_and_delete_loan_charge(self, child, loan_charge_type):
		import fimax.utils
		
		loan_charge = child.get_loan_charge(loan_charge_type)

		if not loan_charge: return
		
		if not loan_charge.status in ("Overdue", "Pending"):
			frappe.throw(__("Could not cancel Loan because Loan Charge {}:{} is not Pending anymore!"
				.format(loan_charge.name, loan_charge.loan_charge_type)))

		fimax.utils.delete_doc(loan_charge)		

		frappe.db.commit()

	def get_double_matched_entry(self, amount, against):
		from erpnext.accounts.utils import get_company_default

		base_gl_entry = {
			"posting_date": self.posting_date,
			"voucher_type": self.doctype,
			"voucher_no": self.name,
			"cost_center": get_company_default(self.company, "cost_center"),
		}

		debit_gl_entry = frappe._dict(base_gl_entry).update({
			"party_type": self.party_type,
			"party": self.party,
			"account": self.party_account,
			"account_currency": frappe.get_value("Account", self.party_account, "account_currency"),
			"against": against,
			"debit": flt(amount) * flt(self.exchange_rate),
			"debit_in_account_currency": flt(amount),
		})

		credit_gl_entry = frappe._dict(base_gl_entry).update({
			"account": against,
			"account_currency": frappe.get_value("Account", against, "account_currency"),
			"against": self.party,
			"credit":  flt(amount) * flt(self.exchange_rate),
			"credit_in_account_currency": flt(amount),
		})
		
		return [debit_gl_entry, credit_gl_entry]

	def make_gl_entries(self, cancel=False, adv_adj=False):
		from erpnext.accounts.general_ledger import make_gl_entries

		# amount that was disbursed from the bank account
		lent_amount = self.get_lent_amount()

		gl_map = self.get_double_matched_entry(lent_amount, self.disbursement_account)
		gl_map += self.get_double_matched_entry(self.legal_expenses_amount, self.income_account)
		gl_map += self.get_double_matched_entry(self.total_interest_amount, self.income_account)

		make_gl_entries(gl_map, cancel=cancel, adv_adj=adv_adj, merge_entries=False)