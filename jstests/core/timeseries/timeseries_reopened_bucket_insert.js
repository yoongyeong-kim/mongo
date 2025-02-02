/**
 * Inserts time-series measurements into closed buckets identified by query-based reopening method.
 *
 * @tags: [
 *   # This test depends on certain writes ending up in the same bucket. Stepdowns may result in
 *   # writes splitting between two primaries, and thus different buckets.
 *   does_not_support_stepdowns,
 *   # We need a timeseries collection.
 *   requires_timeseries,
 *   # This test depends on stats read from the primary node in replica sets.
 *   assumes_read_preference_unchanged,
 * ]
 */
(function() {
"use strict";

load("jstests/core/timeseries/libs/timeseries.js");

if (!TimeseriesTest.timeseriesScalabilityImprovementsEnabled(db)) {
    jsTestLog(
        "Skipped test as the featureFlagTimeseriesScalabilityImprovements feature flag is not enabled.");
    return;
}

const coll = db.timeseries_reopened_bucket_insert;
const bucketsColl = db["system.buckets." + coll.getName()];
const timeField = "time";
const metaField = "mm";
const metaTimeIndexName = [[metaField], "1", [timeField], "1"].join("_");

const resetCollection = function() {
    coll.drop();
    assert.commandWorked(db.createCollection(
        coll.getName(), {timeseries: {timeField: timeField, metaField: metaField}}));
};

const checkIfBucketReopened = function(
    measurement, willCreateBucket = false, willReopenBucket = false) {
    let stats = assert.commandWorked(coll.stats());
    assert(stats.timeseries);
    const prevBucketCount = stats.timeseries['bucketCount'];
    const prevExpectedReopenedBuckets = stats.timeseries['numBucketsReopened'];

    const expectedReopenedBuckets =
        (willReopenBucket) ? prevExpectedReopenedBuckets + 1 : prevExpectedReopenedBuckets;
    const expectedBucketCount = (willCreateBucket) ? prevBucketCount + 1 : prevBucketCount;
    assert.commandWorked(coll.insert(measurement));

    stats = assert.commandWorked(coll.stats());
    assert(stats.timeseries);
    assert.eq(stats.timeseries['bucketCount'], expectedBucketCount);
    assert.eq(stats.timeseries['numBucketsReopened'], expectedReopenedBuckets);
};

const expectNoBucketReopening = function() {
    jsTestLog("Entering expectNoBucketReopening...");
    resetCollection();

    const measurement1 = {
        [timeField]: ISODate("2022-08-26T19:17:00Z"),
        [metaField]: "Bucket1",
    };
    const measurement2 = {
        [timeField]: ISODate("2022-08-26T19:18:00Z"),
        [metaField]: "Bucket1",
    };

    // When there are no open buckets available and none to reopen, we expect to create a new one.
    checkIfBucketReopened(measurement1, /* willCreateBucket */ true, /* willReopenBucket */ false);
    // We don't expect buckets to be created or reopened when a suitable, open bucket exists.
    checkIfBucketReopened(measurement2, /* willCreateBucket */ false, /* willReopenBucket */ false);

    jsTestLog("Exiting expectNoBucketReopening.");
}();

const expectToReopenBuckets = function() {
    jsTestLog("Entering expectToReopenBuckets...");
    resetCollection();

    const measurement1 = {
        [timeField]: ISODate("2022-08-26T19:19:00Z"),
        [metaField]: "ReopenedBucket1",
    };
    const measurement2 = {
        [timeField]: ISODate("2022-08-26T19:19:00Z"),
        [metaField]: "ReopenedBucket1",
    };
    const measurement3 = {
        [timeField]: ISODate("2022-08-26T19:19:00Z"),
        [metaField]: "ReopenedBucket2",
    };

    const bucketDoc = {
        "_id": ObjectId("63091c2c050b7495eaef4580"),
        "control": {
            "version": 1,
            "min": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:00Z")
            },
            "max": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:30Z")
            },
            "closed": false
        },
        "meta": "ReopenedBucket1",
        "data": {
            "_id": {"0": ObjectId("63091c30138e9261fd70a903")},
            "time": {"0": ISODate("2022-08-26T19:19:30Z")}
        }
    };
    const missingClosedFlagBucketDoc = {
        "_id": ObjectId("63091c2c050b7495eaef4581"),
        "control": {
            "version": 1,
            "min": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:00Z")
            },
            "max": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:30Z")
            },
        },
        "meta": "ReopenedBucket2",
        "data": {
            "_id": {"0": ObjectId("63091c30138e9261fd70a903")},
            "time": {"0": ISODate("2022-08-26T19:19:30Z")}
        }
    };

    // Insert closed bucket into the system.buckets collection.
    assert.commandWorked(bucketsColl.insert(bucketDoc));

    checkIfBucketReopened(measurement1, /* willCreateBucket */ false, /* willReopenBucket */ true);
    // Now that we reopened 'bucketDoc' we shouldn't have to open a new bucket.
    checkIfBucketReopened(measurement2, /* willCreateBucket */ false, /* willReopenBucket */ false);

    // Insert closed bucket into the system.buckets collection.
    assert.commandWorked(bucketsColl.insert(missingClosedFlagBucketDoc));
    // We expect to reopen buckets with missing 'closed' flags (this means the buckets are open for
    // inserts).
    checkIfBucketReopened(measurement3, /* willCreateBucket */ false, /* willReopenBucket */ true);

    jsTestLog("Exiting expectToReopenBuckets.");
}();

const expectToReopenBucketsWithComplexMeta = function() {
    jsTestLog("Entering expectToReopenBucketsWithComplexMeta...");
    resetCollection();

    const measurement1 = {
        [timeField]: ISODate("2022-08-26T19:19:00Z"),
        [metaField]: {b: 1, a: 1},
    };
    const measurement2 = {[timeField]: ISODate("2022-08-26T19:19:00Z"), [metaField]: {b: 2, a: 2}};

    const bucketDoc = {
        "_id": ObjectId("63091c2c050b7495eaef4580"),
        "control": {
            "version": 1,
            "min": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:00Z")
            },
            "max": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:30Z")
            },
            "closed": false
        },
        "meta": {a: 1, b: 1},
        "data": {
            "_id": {"0": ObjectId("63091c30138e9261fd70a903")},
            "time": {"0": ISODate("2022-08-26T19:19:30Z")}
        }
    };

    // Insert closed bucket into the system.buckets collection.
    assert.commandWorked(bucketsColl.insert(bucketDoc));

    // Can reopen bucket with complex metadata, even if field order in measurement is different.
    checkIfBucketReopened(measurement1, /* willCreateBucket */ false, /* willReopenBucket */ true);
    // Does not reopen bucket with different complex metadata value.
    checkIfBucketReopened(measurement2, /* willCreateBucket */ true, /* willReopenBucket */ false);

    jsTestLog("Exiting expectToReopenBucketsWithComplexMeta.");
}();

const expectToReopenArchivedBuckets = function() {
    jsTestLog("Entering expectToReopenArchivedBuckets...");
    resetCollection();

    const measurement1 = {
        [timeField]: ISODate("2022-08-26T19:19:00Z"),
        [metaField]: "Meta1",
    };
    const measurement2 = {
        [timeField]: ISODate("2022-08-26T21:19:00Z"),
        [metaField]: "Meta1",
    };
    const measurement3 = {
        [timeField]: ISODate("2022-08-26T19:20:00Z"),
        [metaField]: "Meta1",
    };

    checkIfBucketReopened(measurement1, /* willCreateBucket */ true, /* willReopenBucket */ false);
    // Archive the original bucket due to time forward.
    checkIfBucketReopened(measurement2, /* willCreateBucket */ true, /* willReopenBucket */ false);
    // Reopen original bucket.
    checkIfBucketReopened(measurement3, /* willCreateBucket */ false, /* willReopenBucket */ true);

    jsTestLog("Exiting expectToReopenArchivedBuckets.");
}();

const failToReopenNonSuitableBuckets = function() {
    jsTestLog("Entering failToReopenNonSuitableBuckets...");
    resetCollection();

    const measurement1 = {
        [timeField]: ISODate("2022-08-26T19:19:00Z"),
        [metaField]: "NonSuitableBucket1",
    };
    const measurement2 = {
        [timeField]: ISODate("2022-08-26T19:19:00Z"),
        [metaField]: "NonSuitableBucket2",
    };
    const measurement3 = {
        [timeField]: ISODate("2022-08-26T19:19:00Z"),
        [metaField]: "NonSuitableBucket3",
    };
    const measurement4 = {
        [timeField]: ISODate("2022-08-26T19:19:00Z"),
        [metaField]: "NonSuitableBucket4",
    };
    const measurement5 = {
        [timeField]: ISODate("2022-08-26T19:19:00Z"),
        [metaField]: "Meta",
    };

    const closedBucketDoc = {
        "_id": ObjectId("63091c2c050b7495eaef4582"),
        "control": {
            "version": 1,
            "min": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:00Z")
            },
            "max": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:30Z")
            },
            "closed": true
        },
        "meta": "NonSuitableBucket1",
        "data": {
            "_id": {"0": ObjectId("63091c30138e9261fd70a903")},
            "time": {"0": ISODate("2022-08-26T19:19:30Z")}
        }
    };
    const compressedBucketDoc = {
        "_id": ObjectId("63091c2c050b7495eaef4583"),
        "control": {
            "version": 2,
            "min": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:00Z")
            },
            "max": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:30Z")
            },
            "closed": false
        },
        "meta": "NonSuitableBucket2",
        "data": {
            "_id": {"0": ObjectId("63091c30138e9261fd70a903")},
            "time": {"0": ISODate("2022-08-26T19:19:30Z")}
        }
    };
    const closedAndCompressedBucketDoc = {
        "_id": ObjectId("63091c2c050b7495eaef4584"),
        "control": {
            "version": 2,
            "min": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:00Z")
            },
            "max": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:30Z")
            },
            "closed": true
        },
        "meta": "NonSuitableBucket3",
        "data": {
            "_id": {"0": ObjectId("63091c30138e9261fd70a903")},
            "time": {"0": ISODate("2022-08-26T19:19:30Z")}
        }
    };
    const year2000BucketDoc = {
        "_id": ObjectId("63091c2c050b7495eaef4585"),
        "control": {
            "version": 1,
            "min": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2000-08-26T19:19:00Z")
            },
            "max": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2000-08-26T19:19:30Z")
            },
            "closed": false
        },
        "meta": "NonSuitableBucket4",
        "data": {
            "_id": {"0": ObjectId("63091c30138e9261fd70a903")},
            "time": {"0": ISODate("2022-08-26T19:19:30Z")}
        }
    };
    const metaMismatchFieldBucketDoc = {
        "_id": ObjectId("63091c2c050b7495eaef4586"),
        "control": {
            "version": 1,
            "min": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:00Z")
            },
            "max": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:30Z")
            },
            "closed": false
        },
        "meta": "MetaMismatch",
        "data": {
            "_id": {"0": ObjectId("63091c30138e9261fd70a903")},
            "time": {"0": ISODate("2022-08-26T19:19:30Z")}
        }
    };

    assert.commandWorked(bucketsColl.insert(closedBucketDoc));
    // If an otherwise suitable bucket has the closed flag set, we expect to open a new bucket.
    checkIfBucketReopened(measurement1, /* willCreateBucket */ true, /* willReopenBucket */ false);

    assert.commandWorked(bucketsColl.insert(compressedBucketDoc));
    // If an otherwise suitable bucket is compressed, we expect to open a new bucket.
    checkIfBucketReopened(measurement2, /* willCreateBucket */ true, /* willReopenBucket */ false);

    assert.commandWorked(bucketsColl.insert(closedAndCompressedBucketDoc));
    // If an otherwise suitable bucket is compressed and closed, we expect to open a new bucket.
    checkIfBucketReopened(measurement3, /* willCreateBucket */ true, /* willReopenBucket */ false);

    assert.commandWorked(bucketsColl.insert(year2000BucketDoc));
    // If an otherwise suitable bucket has an incompatible time range with the measurement, we
    // expect to open a new bucket.
    checkIfBucketReopened(measurement4, /* willCreateBucket */ true, /* willReopenBucket */ false);

    assert.commandWorked(bucketsColl.insert(metaMismatchFieldBucketDoc));
    // If an otherwise suitable bucket has a mismatching meta field, we expect to open a new bucket.
    checkIfBucketReopened(measurement5, /* willCreateBucket */ true, /* willReopenBucket */ false);

    jsTestLog("Exiting failToReopenNonSuitableBuckets.");
}();

const failToReopenBucketWithNoMetaTimeIndex = function() {
    jsTestLog("Entering failToReopenBucketWithNoMetaTimeIndex...");
    resetCollection();

    const measurement1 = {
        [timeField]: ISODate("2022-08-26T19:19:00Z"),
        [metaField]: "Suitable1",
    };
    const measurement2 = {
        [timeField]: ISODate("2022-08-26T19:19:00Z"),
        [metaField]: "Suitable2",
    };
    const measurement3 = {
        [timeField]: ISODate("2022-08-26T19:19:00Z"),
        [metaField]: "Suitable3",
    };

    const closedBucketDoc1 = {
        "_id": ObjectId("63091c2c050b7495eaef4581"),
        "control": {
            "version": 1,
            "min": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:00Z")
            },
            "max": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:30Z")
            },
            "closed": false
        },
        "meta": "Suitable1",
        "data": {
            "_id": {"0": ObjectId("63091c30138e9261fd70a903")},
            "time": {"0": ISODate("2022-08-26T19:19:30Z")}
        }
    };
    const closedBucketDoc2 = {
        "_id": ObjectId("63091c2c050b7495eaef4582"),
        "control": {
            "version": 1,
            "min": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:00Z")
            },
            "max": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:30Z")
            },
            "closed": false
        },
        "meta": "Suitable2",
        "data": {
            "_id": {"0": ObjectId("63091c30138e9261fd70a903")},
            "time": {"0": ISODate("2022-08-26T19:19:30Z")}
        }
    };
    const closedBucketDoc3 = {
        "_id": ObjectId("63091c2c050b7495eaef4583"),
        "control": {
            "version": 1,
            "min": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:00Z")
            },
            "max": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:30Z")
            },
            "closed": false
        },
        "meta": "Suitable3",
        "data": {
            "_id": {"0": ObjectId("63091c30138e9261fd70a903")},
            "time": {"0": ISODate("2022-08-26T19:19:30Z")}
        }
    };

    let metaTimeIndex = coll.getIndexes().filter(function(index) {
        return index.name == metaTimeIndexName;
    });
    assert(metaTimeIndex.length == 1);

    assert.commandWorked(bucketsColl.insert(closedBucketDoc1));
    // We expect to reopen the suitable bucket when inserting the first measurement.
    checkIfBucketReopened(measurement1, /* willCreateBucket */ false, /* willReopenBucket */ true);

    // Drop the meta time index.
    assert.commandWorked(coll.dropIndexes([metaTimeIndexName]));
    metaTimeIndex = coll.getIndexes().filter(function(index) {
        return index.name == metaTimeIndexName;
    });
    assert(metaTimeIndex.length == 0);

    assert.commandWorked(bucketsColl.insert(closedBucketDoc2));
    // We have a suitable bucket for the second measurement but it is only visible via query-based
    // reopening which is not supported without the meta and time index.
    checkIfBucketReopened(measurement2, /* willCreateBucket */ true, /* willReopenBucket */ false);

    // Create a meta and time index for query-based reopening.
    assert.commandWorked(
        coll.createIndex({[metaField]: 1, [timeField]: 1}, {name: "generic_meta_time_index_name"}));

    assert.commandWorked(bucketsColl.insert(closedBucketDoc3));
    // Creating an index on meta and time will re-enable us to perform query-based reopening to
    // insert measurement 3 into a suitable bucket.
    checkIfBucketReopened(measurement3, /* willCreateBucket */ false, /* willReopenBucket */ true);

    jsTestLog("Exiting failToReopenBucketWithNoMetaTimeIndex.");
}();

const reopenBucketsWhenSuitableIndexExists = function() {
    jsTestLog("Entering reopenBucketsWhenSuitableIndexExists...");
    resetCollection();

    const measurement1 = {
        [timeField]: ISODate("2022-08-26T19:19:00Z"),
        [metaField]: "Suitable1",
    };
    const measurement2 = {
        [timeField]: ISODate("2022-08-26T19:19:00Z"),
        [metaField]: "Suitable2",
    };
    const measurement3 = {
        [timeField]: ISODate("2022-08-26T19:19:00Z"),
        [metaField]: "Suitable3",
    };
    const measurement4 = {
        [timeField]: ISODate("2022-08-26T19:19:00Z"),
        [metaField]: "Suitable4",
    };

    const closedBucketDoc1 = {
        "_id": ObjectId("63091c2c050b7495eaef4584"),
        "control": {
            "version": 1,
            "min": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:00Z")
            },
            "max": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:30Z")
            },
            "closed": false
        },
        "meta": "Suitable1",
        "data": {
            "_id": {"0": ObjectId("63091c30138e9261fd70a903")},
            "time": {"0": ISODate("2022-08-26T19:19:30Z")}
        }
    };
    const closedBucketDoc2 = {
        "_id": ObjectId("63091c2c050b7495eaef4585"),
        "control": {
            "version": 1,
            "min": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:00Z")
            },
            "max": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:30Z")
            },
            "closed": false
        },
        "meta": "Suitable2",
        "data": {
            "_id": {"0": ObjectId("63091c30138e9261fd70a903")},
            "time": {"0": ISODate("2022-08-26T19:19:30Z")}
        }
    };
    const closedBucketDoc3 = {
        "_id": ObjectId("63091c2c050b7495eaef4586"),
        "control": {
            "version": 1,
            "min": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:00Z")
            },
            "max": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:30Z")
            },
            "closed": false
        },
        "meta": "Suitable3",
        "data": {
            "_id": {"0": ObjectId("63091c30138e9261fd70a903")},
            "time": {"0": ISODate("2022-08-26T19:19:30Z")}
        }
    };
    const closedBucketDoc4 = {
        "_id": ObjectId("63091c2c050b7495eaef4587"),
        "control": {
            "version": 1,
            "min": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:00Z")
            },
            "max": {
                "_id": ObjectId("63091c30138e9261fd70a903"),
                "time": ISODate("2022-08-26T19:19:30Z")
            },
            "closed": false
        },
        "meta": "Suitable4",
        "data": {
            "_id": {"0": ObjectId("63091c30138e9261fd70a903")},
            "time": {"0": ISODate("2022-08-26T19:19:30Z")}
        }
    };

    // Drop the meta time index.
    assert.commandWorked(coll.dropIndexes([metaTimeIndexName]));
    let metaTimeIndex = coll.getIndexes().filter(function(index) {
        return index.name == metaTimeIndexName;
    });
    assert(metaTimeIndex.length == 0);

    // Create a partial index on meta and time.
    assert.commandWorked(
        coll.createIndex({[metaField]: 1, [timeField]: 1},
                         {name: "partialMetaTimeIndex", partialFilterExpression: {b: {$lt: 12}}}));

    assert.commandWorked(bucketsColl.insert(closedBucketDoc1));
    // We expect no buckets to be reopened because a partial index on meta and time cannot be used
    // for query based reopening.
    checkIfBucketReopened(measurement1, /* willCreateBucket */ true, /* willReopenBucket */ false);

    // Create an index on an arbitrary field.
    assert.commandWorked(coll.createIndex({"a": 1}, {name: "arbitraryIndex"}));

    assert.commandWorked(bucketsColl.insert(closedBucketDoc2));
    // We expect no buckets to be reopened because the index created cannot be used for query-based
    // reopening.
    checkIfBucketReopened(measurement2, /* willCreateBucket */ true, /* willReopenBucket */ false);

    // Create an index on an arbitrary field in addition to the meta and time fields.
    assert.commandWorked(
        coll.createIndex({"a": 1, [metaField]: 1, [timeField]: 1}, {name: "nonSuitableIndex"}));

    assert.commandWorked(bucketsColl.insert(closedBucketDoc3));
    // We expect no buckets to be reopened because the index created cannot be used for
    // query-based reopening.
    checkIfBucketReopened(measurement3, /* willCreateBucket */ true, /* willReopenBucket */ false);

    // Create a meta and time index with an additional key on another arbitrary, data field.
    assert.commandWorked(
        coll.createIndex({[metaField]: 1, [timeField]: 1, "a": 1}, {name: metaTimeIndexName}));

    assert.commandWorked(bucketsColl.insert(closedBucketDoc4));
    // We expect to be able to reopen the suitable bucket when inserting the measurement because as
    // long as an index covers the meta and time field, it can have additional keys.
    checkIfBucketReopened(measurement4, /* willCreateBucket */ false, /* willReopenBucket */ true);

    jsTestLog("Exiting reopenBucketsWhenSuitableIndexExists.");
}();
})();
