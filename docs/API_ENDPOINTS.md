# API Endpoints Reference

This file is auto-extracted from the macOS app bundle (best-effort) plus the CLI source. It intentionally excludes tokens, headers, and any personal data.

Notes:

- Some paths contain template placeholders like `${t}`.
- Not every observed path is necessarily active; treat this as a discovery index.

## Full URL Hosts

### api.shopritegroup.co.za
- `/dsl`
- `/dsl/brands/${E}/countries/${_}/consent`
- `/oauth2/token/dsl`

### auth.sixty60.co.za
- `/customers`
- `/customers/${c}/cards/add`
- `/customers/${t}/customer-profile/v2/${u}`
- `/customers/${t}/profile-picture`
- `/customers/${t}/profile-picture-v2`
- `/session/super-app/logout`

### capacity.sixty60.co.za

### catalog.dev.sixty60.co.za
- `/files/61129c91609d1b8c4f8833cc`

### catalog.sixty60.co.za

### dc-app-backend-for-frontend.sixty60.co.za

### help-and-legal-content.sixty60.co.za
- `/`

### orders-api.sixty60.co.za

### pages.sixty60.co.za

### payments.sixty60.co.za

### returns-api.sixty60.co.za

## Common Path Fragments (Unqualified)
These are paths observed in the bundle without a full scheme/host. They may belong to multiple hosts.

- `/api/v1/account/`
- `/api/v1/carts`
- `/api/v1/carts/`
- `/api/v1/collections/collection-slots`
- `/api/v1/collections/validate`
- `/api/v1/delivery-slots/filtered`
- `/api/v1/driver-tip-amounts`
- `/api/v1/lists/`
- `/api/v1/order-groups/`
- `/api/v1/order-issues-v2`
- `/api/v1/orders/`
- `/api/v1/orders/completed-orders`
- `/api/v1/orders/groups`
- `/api/v1/orders/latest-delivered-order-info`
- `/api/v1/orders/payment/methods`
- `/api/v1/orders/track/`
- `/api/v1/otp/generate`
- `/api/v1/otp/loginbymobile/verify`
- `/api/v1/otp/verify`
- `/api/v1/payment/cards/add`
- `/api/v1/payment/is-cvv-required`
- `/api/v1/payments/`
- `/api/v1/payments/3d-secure/`
- `/api/v1/payments/process/`
- `/api/v1/popup/viewed-save`
- `/api/v1/product-driver-rating-reasons`
- `/api/v1/products/`
- `/api/v1/products/favourites`
- `/api/v1/products/favourites/`
- `/api/v1/products/min`
- `/api/v1/products/offers-for-you`
- `/api/v1/products/user-alternatives`
- `/api/v1/retrieve/products/promotions`
- `/api/v1/retrieve/products/promotions/`
- `/api/v1/return-groups/app/user`
- `/api/v1/returns/app/by-id`
- `/api/v1/returns/app/collection-note`
- `/api/v1/returns/app/contact-number`
- `/api/v1/returns/app/refund-method`
- `/api/v1/returns/app/track`
- `/api/v1/returns/cancel`
- `/api/v1/returns/order-group/`
- `/api/v1/returns/order-groups`
- `/api/v1/returns/order-groups/search`
- `/api/v1/returns/submit`
- `/api/v1/search/products/`
- `/api/v1/token/dsl`
- `/api/v1/tvlicence/verify`
- `/api/v1/user/validate`
- `/api/v1/users/login`
- `/api/v1/users/loginbymobile`
- `/api/v1/users/validate/birthdate`
- `/api/v1/users/verify`
- `/api/v2/carts/merge`
- `/api/v2/carts/transfer-dummies`
- `/api/v2/carts/update-address`
- `/api/v2/carts/user`
- `/api/v2/delivered-orders`
- `/api/v2/delivery-slots`
- `/api/v2/display-category-tree`
- `/api/v2/order-groups/`
- `/api/v2/orders`
- `/api/v2/orders/history`
- `/api/v2/orders/pre-order`
- `/api/v2/payments/retry/order-group/`
- `/api/v2/payments/tip/`
- `/api/v2/popup/user/`
- `/api/v2/retrieve/promotions/`
- `/api/v2/search/history`
- `/api/v2/search/history/delete`
- `/api/v2/search/history/delete/all`
- `/api/v2/search/products/`
- `/api/v3/carts/`
- `/api/v3/carts/have-you-forgotten`
- `/api/v3/first-delivery-slots`
- `/api/v3/issues/`
- `/api/v3/orders`
- `/api/v3/orders/`
- `/api/v3/orders/my-products`
- `/api/v3/orders/order-groups-info`
- `/api/v3/orders/pre-order`
- `/api/v3/orders/request-credit-delivered-orders`
- `/api/v3/products/credit-request`
- `/api/v3/products/filter`
- `/api/v3/products/product-list-page`
- `/api/v3/search/products`
- `/api/v3/store-contexts`
- `/api/v4/products/filter/options`

## Endpoints Used By This CLI

- `https://api.shopritegroup.co.za/dsl/brands/checkers/countries/ZA`
- `https://auth.sixty60.co.za`
- `https://catalog.sixty60.co.za`
- `https://dc-app-backend-for-frontend.sixty60.co.za`
- `https://orders-api.sixty60.co.za`

- `/api/v1/carts/`
- `/api/v1/token/dsl`
- `/api/v2/carts/user`
- `/api/v2/orders/history`
- `/api/v3/carts/update`
- `/api/v3/products/product-list-page`
- `/api/v3/store-contexts`
