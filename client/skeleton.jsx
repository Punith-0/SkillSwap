import React from 'react';
import './shared/skeleton.css';
export function Skeleton({kind='cards',count=3}){
 return <section className={'skeleton-layout skeleton-'+kind} role="status" aria-label="Loading workspace" aria-busy="true"><span className="sr-only">Loading…</span>{Array.from({length:count},(_,i)=><div className="skeleton-card" key={i} aria-hidden="true"><i className="skeleton-block skeleton-avatar"/><i className="skeleton-block skeleton-title"/><i className="skeleton-block"/><i className="skeleton-block skeleton-short"/><i className="skeleton-block skeleton-action"/></div>)}</section>;
}
