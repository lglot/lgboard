"""python3 -m unittest test_agent (from this directory). launchctl is faked, nothing touches launchd."""
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

import agent

LABEL = "com.luigi.job"


class FakeLaunchd:
    """The bits of launchd state the agent relies on. `stuck` ignores every command."""

    def __init__(self, stuck=False):
        self.disabled, self.loaded, self.stuck = set(), {LABEL}, stuck

    def sh(self, cmd, timeout=6.0):
        verb = cmd[1]
        if verb == "print-disabled":
            return "".join(f'"{x}" => disabled\n' for x in self.disabled) + '"com.apple.x" => disabled\n'
        if self.stuck:
            return ""
        if verb == "disable":
            self.disabled.add(cmd[2].rsplit("/", 1)[1])
        elif verb == "enable":
            self.disabled.discard(cmd[2].rsplit("/", 1)[1])
        elif verb == "bootout":
            self.loaded.discard(cmd[2].rsplit("/", 1)[1])
        elif verb == "bootstrap":
            self.loaded.add(Path(cmd[3]).stem)
        return ""


class SetPausedTest(unittest.TestCase):
    def _with(self, launchd):
        return (mock.patch.object(agent, "_sh", launchd.sh),
                mock.patch.object(agent, "_loaded", lambda label: label in launchd.loaded))

    def test_pause_then_resume_round_trip(self):
        launchd = FakeLaunchd()
        sh, loaded = self._with(launchd)
        with sh, loaded:
            agent.set_paused(LABEL, True)
            self.assertEqual(agent.paused_labels(), [LABEL])  # com.apple.x stays out
            self.assertNotIn(LABEL, launchd.loaded)
            agent.set_paused(LABEL, True)  # already paused is not an error
            agent.set_paused(LABEL, False)
            self.assertEqual(agent.paused_labels(), [])
            self.assertIn(LABEL, launchd.loaded)

    def test_launchd_not_obeying_is_reported(self):
        sh, loaded = self._with(FakeLaunchd(stuck=True))
        with sh, loaded, self.assertRaises(RuntimeError):
            agent.set_paused(LABEL, True)


class HttpTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        token = Path(self.tmp.name) / "token"
        token.write_text("s3cret\n")
        plists = Path(self.tmp.name)
        (plists / f"{LABEL}.plist").write_text("")
        for patcher in (mock.patch.object(agent, "TOKEN_FILE", token),
                        mock.patch.object(agent, "LAUNCH_AGENTS", plists),
                        mock.patch.object(agent, "set_paused", mock.Mock())):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), agent.Handler)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.addCleanup(self.srv.server_close)
        self.addCleanup(self.srv.shutdown)

    def _post(self, body, token="s3cret"):
        req = urllib.request.Request(f"http://127.0.0.1:{self.srv.server_address[1]}/api/automations/pause",
                                     data=json.dumps(body).encode(),
                                     headers={"Authorization": f"Bearer {token}"} if token else {})
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status
        except urllib.error.HTTPError as e:
            return e.code

    def test_needs_the_token(self):
        self.assertEqual(self._post({"label": LABEL, "paused": True}, token=None), 401)
        self.assertEqual(self._post({"label": LABEL, "paused": True}, token="nope"), 401)
        agent.set_paused.assert_not_called()

    def test_no_token_file_means_no_control(self):
        agent.TOKEN_FILE.unlink()
        self.assertEqual(self._post({"label": LABEL, "paused": True}), 401)

    def test_only_own_existing_jobs(self):
        for label in ("com.lglot.lgboard-mac-agent", "com.luigi.../evil", 7):
            self.assertEqual(self._post({"label": label, "paused": True}), 400)
        self.assertEqual(self._post({"label": "com.luigi.ghost", "paused": True}), 404)
        self.assertEqual(self._post({"label": LABEL, "paused": "yes"}), 400)
        agent.set_paused.assert_not_called()

    def test_valid_request_is_applied(self):
        self.assertEqual(self._post({"label": LABEL, "paused": True}), 200)
        agent.set_paused.assert_called_once_with(LABEL, True)


if __name__ == "__main__":
    unittest.main()
