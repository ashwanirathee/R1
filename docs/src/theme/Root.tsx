import React from 'react';
import R1Chat from '../components/R1Chat/R1Chat';

export default function Root({children}: {children: React.ReactNode}) {
  return (
    <>
      {children}
      <R1Chat />
    </>
  );
}