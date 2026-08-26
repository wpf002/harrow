// The store is IndexedDB-backed because the app must work with no network and survive
// the browser being killed mid-session. Tests run against a real IndexedDB
// implementation rather than a mock, so the transaction and key semantics under test
// are the ones that will actually run in the field.
import 'fake-indexeddb/auto';
