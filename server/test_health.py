import unittest

from .health import HealthChecker


class DiscoveredUrlFallbackTest(unittest.TestCase):
    def _eval(self, app):
        return HealthChecker(get_apps=lambda: [], timeout=1)._evaluate(app)

    def test_unresolvable_discovered_url_falls_back_to_container_state(self):
        app = {
            "id": "x", "internalUrl": "http://no-such-container.invalid:8000/",
            "_discovered": True, "_containerMatched": True, "_containerState": "running",
        }
        res = self._eval(app)
        self.assertEqual((res["status"], res["reason"]), ("up", "container-running"))

    def test_unresolvable_explicit_url_stays_down(self):
        res = self._eval({"id": "x", "internalUrl": "http://no-such-container.invalid:8000/"})
        self.assertEqual((res["status"], res["reason"]), ("down", "unreachable"))


if __name__ == "__main__":
    unittest.main()
