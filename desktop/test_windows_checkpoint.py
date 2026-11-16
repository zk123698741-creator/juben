"""Regression: preflight checkpoint IDs must not create NTFS alternate streams."""
import asyncio
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from utils.agent_infra.checkpoint import CheckpointStore


class WindowsCheckpointTest(unittest.TestCase):
    def test_preflight_id_survives_save_load_and_listing(self):
        with tempfile.TemporaryDirectory() as directory:
            store = CheckpointStore(directory)
            checkpoint_id = 'atelier_test_preflight:juben_conductor'
            asyncio.run(store.save(checkpoint_id, {'step': 2, 'status': 'completed'}))
            files = list(Path(directory).glob('*.json'))
            self.assertEqual(len(files), 1)
            restored = asyncio.run(store.load(checkpoint_id))
            self.assertEqual(restored.checkpoint_id, checkpoint_id)
            self.assertEqual(restored.step, 2)
            self.assertTrue(asyncio.run(store.delete(checkpoint_id)))


if __name__ == '__main__':
    unittest.main()
