// Copyright (c) 2017, Yefri Tavarez and contributors
// For license information, please see license.txt

frappe.provide("fimax.loan_appl");
frappe.ui.form.on('Loan Application', {
	"onload": (frm) => {
		let event_list = ["set_approver", "set_default_values"];
		$.map(event_list, (event) => frm.trigger(event));
	},
	"refresh": (frm) => {
		let event_list = ["set_queries", "add_fecthes", 
			"update_interest_rate_label", "show_hide_party_name",
			"show_hide_fields_based_on_role", "add_custom_buttons"];
		$.map(event_list, (event) => frm.trigger(event));
	},
	"set_approver": (frm) => {
		if (frappe.user.has_role(["Loan Approver", "Loan Manager"])) {
			if ( ! frm.doc.approver) {
				frm.doc.approver = frappe.session.user;
				frm.doc.approver_name = frappe.boot.user_info[frappe.session.user].fullname;
			}
		}
	},
	"set_default_values": (frm) => {
		let event_list = ["set_default_status", "set_default_repayment_frequency"];
		if (frm.is_new()) {
			$.map(event_list, (event) => frm.trigger(event));
		}
	},
	"set_default_status": (frm) => {
		frm.set_value("status", "Open");
	},
	"set_default_status": (frm) => {
		frm.set_value("repayment_frequency", frappe.boot.conf.repayment_frequency);
	},
	"set_queries": (frm) => {
		let queries = ["set_party_type_query"];
		$.map(queries, (event) => frm.trigger(event));
	}, 	
	"add_fecthes": (frm) => {
		let queries = ["add_party_fetch"];
		$.map(queries, (event) => frm.trigger(event));
	},
	"add_custom_buttons": (frm) => {
		let has_permission = frappe.user.has_role(["Loan Approver", "Loan Manager"]);
		let allow_to_change_action = frappe.boot.conf.allow_change_action;
		let allowed = allow_to_change_action || (frm.doc.status == "Open" && frm.doc.status != "Completed");

		if (has_permission && frm.doc.docstatus == 1 && allowed) {
			$.map(["add_approved_button", "add_deny_button"], (event) => frm.trigger(event));
			frm.doc.status != "Approved" &&	frm.page.set_inner_btn_group_as_primary(__("Action"));
		}

		has_permission = frappe.user.has_role(["Loan Approver", "Loan Manager", "Loan User"]);
		if (frm.doc.docstatus == 1 && frm.doc.status == "Approved" && has_permission) {
			frappe.db.get_value("Loan", {
				"loan_application": frm.docname,
				"docstatus": ["!=", "2"]
			}, ["name"]).done((response) => {
				let data = response.message;

				if (data) {
					frm.trigger("add_view_loan_button");
					frm.doc.loan = data.loan;
				} else {
					frm.trigger("add_make_loan_button");
				}

				frm.page.set_inner_btn_group_as_primary(__("Loan"));
			});
		}

		if (frm.is_new()) {
			frm.trigger("add_new_customer_button");
			frm.trigger("add_new_supplier_button");
			frm.trigger("add_new_employee_button");
			
			frm.page.set_inner_btn_group_as_primary(__("New"));
		}
	},
	"set_party_type_query": (frm) => {
		frm.set_query("party_type", () => {
			return {
				"filters": {
					"name": ["in", ["Supplier", "Customer", "Employee"]]
				}
			};
		});
	},
	"party_type": (frm) => {
		frm.trigger("clear_party") && frm.trigger("refresh");
	},
	"party": (frm) => {
		if ( ! frm.doc.party) {
			frm.trigger("clear_party_name");
		} else {
			frappe.run_serially([
				() => frappe.timeout(2.5),
				() => frm.trigger("set_party_name"),
				() => frm.trigger("set_party_currency")
			]);
		}
	},
	"set_party_name": (frm) => {
		let party_field = __("{0}_name", [frm.doc.party_type]);

		frappe.db.get_value(frm.doc.party_type, frm.doc.party, party_field.toLocaleLowerCase())
			.done((response) => {
				let party_name = response.message[party_field.toLocaleLowerCase()];
				frm.set_value("party_name", party_name);
				frm.trigger("show_hide_party_name");
			}).fail((exec) => frappe.msgprint(__("There was a problem while loading the party name!")));
	},
	"set_party_currency": (frm) => {
		let default_currency = frappe.defaults.get_default("currency");

		if (["Customer", "Supplier"].includes(frm.doc.party_type)) {
			frappe.db.get_value(frm.doc.party_type, frm.doc.party, "default_currency")
				.done((response) => {
					default_currency = response.message["default_currency"];
					default_currency && frm.set_value("currency", default_currency);
				}).fail((exec) => frappe.msgprint(__("There was a problem while loading the party default currency!")));
		}

		frm.set_value("currency", default_currency);
	},
	"clear_party_name": (frm) => {
		frm.set_value("party_name", undefined);
	},
	"clear_party": (frm) => {
		frappe.run_serially([
			() => frm.set_value("party", undefined),
			() => frm.trigger("clear_party_name")
		]);
	},
	"approver": (frm) => {
		if ( ! frm.docstatus.approver) {
			frm.set_value("approver_name", undefined);
		}
	},
	"requested_gross_amount": (frm) => {
		if (frm.doc.owner == frappe.session.user) {
			frm.trigger("update_approved_gross_amount");
		}

		frm.trigger("calculate_loan_amount");
	},
	"legal_expenses_rate": (frm) => frm.trigger("calculate_loan_amount"),
	"approved_gross_amount": (frm) => frm.trigger("calculate_loan_amount"),
	"repayment_periods": (frm) => frappe.run_serially([
		() => frm.trigger("validate_repayment_periods"),
		() => frm.trigger("calculate_loan_amount")
	]),
	"repayment_frequency": (frm) => frm.trigger("update_interest_rate_label"),
	"loan_type": (frm) => {
		if ( ! frm.doc.loan_type) {
			return 0; // exit code is zero
		}

		frappe.db.get_value(frm.fields_dict.loan_type.df.options, frm.doc.loan_type, "*")
			.done((response) => {
				let loan_type = response.message;

				if ( loan_type && ! loan_type["enabled"]) {
					frappe.run_serially([
						() => frm.set_value("loan_type", undefined),
						() => frappe.throw(__("{0}: {1} is disabled.", 
							[frm.fields_dict.loan_type.df.options, loan_type.loan_name]))
					]);
				}

				$.map([
					"currency",
					"interest_type",
					"legal_expenses_rate",
					"repayment_day_of_the_month",
					"repayment_day_of_the_week",
					"repayment_days_after_cutoff",
					"repayment_frequency",
				], fieldname => frm.set_value(fieldname, loan_type[fieldname]));
				
				let repayment_interest_rate = flt(loan_type["interest_rate"]) /
					fimax.utils.frequency_in_years(frm.doc.repayment_frequency);

				frm.set_value("interest_rate", repayment_interest_rate);
			});
	},
	"update_interest_rate_label": (frm) => {
		let new_label = __("Interest Rate ({0})", [frm.doc.repayment_frequency]);
		frm.set_df_property("interest_rate", "label", new_label);
	},
	"add_approved_button": (frm) => {
		frm.add_custom_button(__("Approve"), () => frm.trigger("approve_loan_appl"), __("Action"));
	},
	"add_deny_button": (frm) => {
		frm.add_custom_button(__("Deny"), () => frm.trigger("deny_loan_appl"), __("Action"));
	},
	"add_make_loan_button": (frm) => {
		frm.add_custom_button(__("Make"), () => frm.trigger("make_loan"), __("Loan"));
	},
	"add_view_loan_button": (frm) => {
		frm.add_custom_button(__("View"), () => frm.trigger("view_loan"), __("Loan"));
	},
	"add_new_customer_button": (frm) => {
		frm.add_custom_button(__("Customer"), () => frm.trigger("new_customer"), __("New"));
	},
	"add_new_supplier_button": (frm) => {
		frm.add_custom_button(__("Supplier"), () => frm.trigger("new_supplier"), __("New"));
	},
	"add_new_employee_button": (frm) => {
		frm.add_custom_button(__("Employee"), () => frm.trigger("new_employee"), __("New"));
	},
	"show_hide_party_name": (frm) => {
		frm.toggle_display("party_name", frm.doc.party != frm.doc.party_name);
	},
	"show_hide_fields_based_on_role": (frm) => {
		$.map(["approved_gross_amount"], 
			(field) => frm.toggle_enable(field, !! frappe.user.has_role(["Loan Approver", "Loan Manager"])));

		$.map([
			"posting_date",
			"party_type",
			"party",
			"party_name",
			"currency",
			"company",
			"requested_gross_amount",
			"legal_expenses_rate",
			"repayment_frequency",
			"repayment_periods",
			"interest_rate",
			"interest_type",
		], 
			(field) => frm.toggle_enable(field, frappe.session.user == frm.doc.owner));

		frm.toggle_enable("approved_gross_amount", ! ["Approved", "Rejected"].includes(frm.doc.status));
	},
	"validate": (frm) => {
		$.map([
			"validate_legal_expenses_rate",
			"validate_requested_gross_amount",
			"validate_repayment_periods",
		], (validation) => frm.trigger(validation));
	},
	"calculate_loan_amount": (frm) => {
		let can_proceed = frm.doc.requested_gross_amount 
			&& frm.doc.legal_expenses_rate && frm.doc.repayment_periods;
		
		if (can_proceed) {
			frappe.run_serially([
				() => frm.trigger("calculate_legal_expenses_amount"),
				() => frm.trigger("calculate_requested_net_amount"),
				() => frm.trigger("calculate_approved_net_amount"),
			]);
		} else { 
			frm.doc.legal_expenses_amount = 0.000;
			frm.doc.approved_net_amount = 0.000;
		}
	},		
	"calculate_legal_expenses_amount": (frm) => {
		frm.doc.legal_expenses_amount = flt(frm.doc.approved_gross_amount)
			* fimax.utils.from_percent_to_decimal(frm.doc.legal_expenses_rate);
		refresh_field("legal_expenses_amount");
	},
	"calculate_requested_net_amount": (frm) => {
		frm.doc.requested_net_amount = flt(frm.doc.requested_gross_amount)
			* flt(flt(frm.doc.legal_expenses_rate / 100.000) + 1);
		refresh_field("requested_net_amount");
	},
	"calculate_approved_net_amount": (frm) => {
		frm.doc.approved_net_amount = flt(frm.doc.legal_expenses_amount) 
			+ flt(frm.doc.approved_gross_amount);
		refresh_field("approved_net_amount");
	},
	"update_approved_gross_amount": (frm) => {
		frm.set_value("approved_gross_amount", frm.doc.requested_gross_amount);
	},
	"validate_legal_expenses_rate": (frm) => {
		if ( ! frm.doc.legal_expenses_rate) {
			frappe.throw(__("Missing Legal Expenses Rate"));
		}
	},
	"validate_requested_gross_amount": (frm) => {
		if ( ! frm.doc.approved_gross_amount) {
			if ( ! frm.doc.requested_gross_amount) {
				frappe.throw(__("Missing Requested Gross Amount"));
			} else {
				frappe.throw(__("Missing Approved Gross Amount"));
			}
		}
	},
	"validate_repayment_periods": (frm) => {
		if ( ! frm.doc.repayment_periods) {
			frappe.throw(__("Missing Repayment Periods"));
		}
	}, 
	"approve_loan_appl": (frm) => {
		frm.doc.status = "Approved";
		frm.save("Update");
	},
	"deny_loan_appl": (frm) => {
		frm.doc.status = "Rejected";
		frm.save("Update");
	},
	"view_loan": (frm) => {
		frappe.db.get_value("Loan", {
			"loan_application": frm.docname,
			"docstatus": ["!=", "2"]
		}, "name").done((response) => {
			let loan = response.message["name"];

			if (loan) {
				frappe.set_route("Form", "Loan", loan);
			} else {
				frappe.msgprint(__("Loan not found"));
			}
		});
	},
	"make_loan": (frm) => {
		let opts = {
			"method": "fimax.api.create_loan_from_appl"
		};

		opts.args = {
			"doc": frm.doc
		}

		frappe.call(opts).done((response) => {
			let doc = response.message;

			doc = frappe.model.sync(doc)[0];
			frappe.set_route("Form", doc.doctype, doc.name);
		}).fail((exec) => frappe.msgprint(__("There was an error while creating the Loan")));
	},
	"new_customer": (frm) => {
		fimax.loan_appl.url = frappe.get_route();
		frappe.new_doc("Customer");
	},
	"new_supplier": (frm) => {
		fimax.loan_appl.url = frappe.get_route();
		frappe.new_doc("Supplier");
	},
	"new_employee": (frm) => {
		fimax.loan_appl.url = frappe.get_route();
		frappe.new_doc("Employee");
	}
});
