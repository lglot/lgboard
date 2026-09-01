import os
import tempfile
import unittest

from .stats import read_disks


class ReadDisksTest(unittest.TestCase):
    def test_unmounted_mountpoint_on_root_device_is_skipped(self):
        with tempfile.TemporaryDirectory() as root:
            empty = os.path.join(root, "hdd2")
            os.mkdir(empty)
            cfg = [
                {"id": "rootfs", "label": "rootfs", "path": root},
                {"id": "hdd2", "label": "HDD2", "path": empty},
                {"id": "gone", "label": "gone", "path": os.path.join(root, "missing")},
            ]
            self.assertEqual([d["id"] for d in read_disks(cfg, root)], ["rootfs"])
            # Without a root path the old behaviour is kept: same-device paths pass.
            self.assertEqual([d["id"] for d in read_disks(cfg)], ["rootfs", "hdd2"])


if __name__ == "__main__":
    unittest.main()
