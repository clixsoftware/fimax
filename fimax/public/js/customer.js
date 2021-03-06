// Copyright (c) 2017, Yefri Tavarez and contributors
// For license information, please see license.txt

frappe.provide("fimax.loan_appl");
frappe.ui.form.on('Customer', {
	"after_save": (frm) => {
		let url = fimax.loan_appl.url;

		if (!url) {
			return 0;
		}

		frappe.model.set_value(url[1], url[2], "party_type", frm.doctype);
		frappe.model.set_value(url[1], url[2], "party", frm.docname);
		frappe.model.set_value(url[1], url[2], "party_name", frm.doc.customer_name);

		if (frm.doc.default_currency) {
			frappe.model.set_value(url[1], url[2], "currency", frm.doc.default_currency);
		}

		setTimeout(() => frappe.set_route(url), 500);

		delete fimax.loan_appl.url;
	}
});
