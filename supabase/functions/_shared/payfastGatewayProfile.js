/**
 * OPPS-106 production candidate: pure gateway environment profile.
 * Never expose the return value to a browser. No external requests or DB writes.
 * A live profile requires a separate deployed live edge function and TWO
 * explicit deployment approvals, in addition to private merchant credentials.
 */
const hosts=Object.freeze({
  sandbox:Object.freeze({
    process:"https://sandbox.payfast.co.za/eng/process",
    validate:"https://sandbox.payfast.co.za/eng/query/validate"
  }),
  live:Object.freeze({
    process:"https://www.payfast.co.za/eng/process",
    validate:"https://www.payfast.co.za/eng/query/validate"
  })
});
export const PAYFAST_ENDPOINTS=hosts;
const error=code=>({ok:false,reason:code});
const clean=(v)=>typeof v==="string"&&v.length>0&&v===v.trim();
const isValidMerchant=(v)=>clean(v)&&/^\d{6,20}$/.test(v);
const isHttpsUrl=(s)=>typeof s==="string"&&/^https:\/\/[a-z\d.-]+(?:\/[^\s]*)?$/.test(s);

/** All inputs must come from a trusted server-only environment object. */
export function getPayfastGatewayProfile(env,expectedMode) {
  if(!env || !["sandbox","live"].includes(expectedMode)) return error("MODE_REQUIRED");
  // Endpoint selection cannot be influenced by an ITN, browser or QR token.
  if(env.PAYFAST_SANDBOX !== String(expectedMode==="sandbox")) return error("MODE_MISMATCH");
  if(!isValidMerchant(env.PAYFAST_MERCHANT_ID)
     || !clean(env.PAYFAST_MERCHANT_KEY)
     || !clean(env.PAYFAST_PASSPHRASE)) return error("CREDENTIALS_REQUIRED");
  if(expectedMode==="live"){
    // Both gates required. These gates are *not* substitutes for DB issuer switches.
    if(env.OPPS106_LIVE_GATEWAY_APPROVED !== "true"
      || env.OPPS106_LIVE_CALLBACK_ENABLED !== "true") return error("LIVE_NOT_APPROVED");
    if(env.OPPS106_QR_MODE !== "live") return error("LIVE_CONFIG_MISMATCH");
    if(!isHttpsUrl(env.OPPS106_LIVE_RETURN_BASE)
      || !isHttpsUrl(env.OPPS106_LIVE_NOTIFY_URL)
      || new URL(env.OPPS106_LIVE_RETURN_BASE).hostname.endsWith(".vercel.app")
      || new URL(env.OPPS106_LIVE_NOTIFY_URL).hostname.endsWith(".vercel.app"))
      return error("LIVE_URLS_REQUIRED");
  } else if(env.OPPS106_QR_MODE!=="sandbox") return error("SANDBOX_CONFIG_MISMATCH");
  const endpoints=hosts[expectedMode];
  return Object.freeze({
    ok:true,
    environment:expectedMode,
    merchantId:env.PAYFAST_MERCHANT_ID,
    merchantKey:env.PAYFAST_MERCHANT_KEY,
    passphrase:env.PAYFAST_PASSPHRASE,
    processUrl:endpoints.process,
    validationUrl:endpoints.validate,
    evidence:expectedMode==="sandbox"?"payfast_itn_validated_sandbox":"payfast_itn_validated_live",
    returnBase:expectedMode==="live"?env.OPPS106_LIVE_RETURN_BASE:null,
    notifyUrl:expectedMode==="live"?env.OPPS106_LIVE_NOTIFY_URL:null
  });
}
/** Used only to compare server-persisted checkout context to the chosen profile. */
export function matchGatewayCheckoutProfile(profile,checkout) {
  if(profile?.ok!==true||!checkout||!["live","sandbox"].includes(checkout.environment))
    return error("PROFILE_NOT_VERIFIED");
  if(profile.environment!==checkout.environment) return error("ENVIRONMENT_MISMATCH");
  if(profile.merchantId!==checkout.merchantId) return error("MERCHANT_MISMATCH");
  if(!clean(checkout.gatewayReference)||!/^JXQR-[\da-f-]{36}$/i.test(checkout.gatewayReference))
    return error("CHECKOUT_REFERENCE_INVALID");
  if(!Number.isSafeInteger(checkout.amountCents)||checkout.amountCents<=0)
    return error("AMOUNT_INVALID");
  return {ok:true,environment:profile.environment,merchantId:profile.merchantId,
    reference:checkout.gatewayReference,amountCents:checkout.amountCents,
    evidence:profile.evidence};
}
