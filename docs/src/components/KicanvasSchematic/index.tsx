import {createElement, useEffect, type ReactNode} from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';

import styles from './styles.module.css';

const KICANVAS_SCRIPT_SRC = 'https://kicanvas.org/kicanvas/kicanvas.js';

export default function KicanvasSchematic(): ReactNode {
  const scriptSrc = KICANVAS_SCRIPT_SRC;
  const schematicSrc = useBaseUrl('/r1-control/kicad/schematic.kicad_sch');

  useEffect(() => {
    if (document.querySelector(`script[src="${scriptSrc}"]`)) {
      return;
    }

    const script = document.createElement('script');
    script.type = 'module';
    script.src = scriptSrc;
    script.async = true;
    document.head.appendChild(script);
  }, [scriptSrc]);

  return (
    <div className={styles.schematic}>
      <div className={styles.viewer}>
        {createElement('kicanvas-embed', {
          src: schematicSrc,
          controls: 'full',
          controlslist: 'nodownload',
          theme: 'kicad',
        })}
      </div>
    </div>
  );
}
