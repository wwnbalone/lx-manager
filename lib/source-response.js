function isObjectLike(value) {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}

function stringifyMessage(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function unwrapKnownEnvelope(result) {
    if (!isObjectLike(result)) {
        return { ok: true, value: result };
    }

    if ('code' in result || 'msg' in result || 'data' in result) {
        const numericCode = Number(result.code);
        if (Number.isFinite(numericCode) && numericCode !== 0) {
            return {
                ok: false,
                reason: 'upstream_code_error',
                details: {
                    code: numericCode,
                    msg: stringifyMessage(result.msg),
                },
            };
        }

        return {
            ok: true,
            value: result.data ?? result.url ?? result,
            envelope: result,
        };
    }

    if ('success' in result || 'message' in result || 'data' in result) {
        if (result.success === false) {
            return {
                ok: false,
                reason: 'upstream_success_false',
                details: {
                    message: stringifyMessage(result.message),
                },
            };
        }

        if (result.success === true && 'data' in result) {
            return {
                ok: true,
                value: result.data,
                envelope: result,
            };
        }
    }

    return { ok: true, value: result };
}

function normalizeUrlResult(result) {
    const unwrapped = unwrapKnownEnvelope(result);
    if (!unwrapped.ok) return null;

    const value = unwrapped.value;
    if (!value) return null;
    if (typeof value === 'string') return value.trim() || null;
    if (typeof value.url === 'string') return value.url.trim() || null;
    if (typeof value.data === 'string') return value.data.trim() || null;
    if (typeof value.data?.url === 'string') return value.data.url.trim() || null;
    return null;
}

module.exports = {
    unwrapKnownEnvelope,
    normalizeUrlResult,
};
