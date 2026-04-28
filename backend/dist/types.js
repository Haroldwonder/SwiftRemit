"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KycStatus = exports.VerificationStatus = void 0;
var VerificationStatus;
(function (VerificationStatus) {
    VerificationStatus["Verified"] = "verified";
    VerificationStatus["Unverified"] = "unverified";
    VerificationStatus["Suspicious"] = "suspicious";
})(VerificationStatus || (exports.VerificationStatus = VerificationStatus = {}));
var KycStatus;
(function (KycStatus) {
    KycStatus["Pending"] = "pending";
    KycStatus["Approved"] = "approved";
    KycStatus["Rejected"] = "rejected";
    KycStatus["Expired"] = "expired";
})(KycStatus || (exports.KycStatus = KycStatus = {}));
