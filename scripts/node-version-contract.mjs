function parseNodeVersion(value) {
    const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
    if (match === null) {
        return undefined;
    }

    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
    };
}

function parseEngineRange(value) {
    const match = /^>=(\d+\.\d+\.\d+)\s+<(\d+)$/.exec(value.trim());
    if (match === null) {
        return undefined;
    }

    const minimum = parseNodeVersion(match[1]);
    const upperBoundMajor = Number(match[2]);
    if (minimum === undefined || !Number.isSafeInteger(upperBoundMajor)) {
        return undefined;
    }

    return { minimum, upperBoundMajor };
}

function compareNodeVersions(left, right) {
    if (left.major !== right.major) {
        return left.major - right.major;
    }
    if (left.minor !== right.minor) {
        return left.minor - right.minor;
    }
    return left.patch - right.patch;
}

export function isSupportedNodeVersion(version, engineRange) {
    const parsedVersion = parseNodeVersion(version);
    const parsedRange = parseEngineRange(engineRange);
    if (parsedVersion === undefined || parsedRange === undefined) {
        return false;
    }

    return (
        compareNodeVersions(parsedVersion, parsedRange.minimum) >= 0 &&
        parsedVersion.major < parsedRange.upperBoundMajor
    );
}
