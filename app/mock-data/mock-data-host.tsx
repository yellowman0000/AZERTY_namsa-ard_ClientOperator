'use client';

/**
 * Mounts the mock-data orb, its "active" chip and the editor dialog once, in the
 * root layout, so the tool is available on every route.
 *
 * The dialog uses the native `<dialog>` element like the log inspection modal:
 * focus trapping, Escape and top-layer stacking come from the browser, and focus
 * returns to the orb on close. `now` is only read inside click handlers.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { MOCK_DATASETS, mockDataStore } from '../../lib/mockData';
import { useMockData } from '../../lib/mockData/useMockData';
import MockPanel from './mock-panel';
import { MockBanner, MockOrb } from './mock-orb';

export default function MockDataHost() {
  const snapshot = useMockData();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const openPanel = useCallback(() => {
    setOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    dialogRef.current?.close();
  }, []);

  const toggle = useCallback(() => {
    mockDataStore.toggle(new Date());
  }, []);

  const selectDataset = useCallback((datasetId: string) => {
    mockDataStore.selectDataset(datasetId);
  }, []);

  const addRow = useCallback((datasetId: string) => {
    mockDataStore.addRow(datasetId, new Date());
  }, []);

  const removeRow = useCallback((datasetId: string, index: number) => {
    mockDataStore.removeRow(datasetId, index);
  }, []);

  const changeField = useCallback(
    (datasetId: string, index: number, key: string, value: string | number | boolean | null) => {
      mockDataStore.updateField(datasetId, index, key, value);
    },
    []
  );

  const resetDataset = useCallback((datasetId: string) => {
    mockDataStore.resetDataset(datasetId, new Date());
  }, []);

  const resetAll = useCallback(() => {
    mockDataStore.resetAll(new Date());
  }, []);

  const filledDatasetCount = MOCK_DATASETS.filter(
    (dataset) => (snapshot.datasets[dataset.id]?.length ?? 0) > 0
  ).length;

  return (
    <>
      <MockBanner
        active={snapshot.active}
        datasetCount={filledDatasetCount}
        onOpen={openPanel}
      />
      <MockOrb active={snapshot.active} expanded={open} onOpen={openPanel} />
      <dialog
        ref={dialogRef}
        className="mock-dialog"
        aria-labelledby="mock-title"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) closePanel(); // backdrop click
        }}
      >
        <MockPanel
          snapshot={snapshot}
          datasets={MOCK_DATASETS}
          onToggle={toggle}
          onSelectDataset={selectDataset}
          onAddRow={addRow}
          onRemoveRow={removeRow}
          onChangeField={changeField}
          onResetDataset={resetDataset}
          onResetAll={resetAll}
          onClose={closePanel}
        />
      </dialog>
    </>
  );
}
