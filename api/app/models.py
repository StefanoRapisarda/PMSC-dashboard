"""The relational schema.

One table per thing that exists in the lab, plus an `edges` table.

Why both: the design splits counting questions from traversal questions.
Counting ("how many specimens cleared QC") is a GROUP BY over the entity
tables. Traversal ("what else came out of this freezer box") walks edges. In
production these would be two stores; here one file serves both, and the API
keeps the split visible so that swap stays cheap.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import Boolean, Date, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Study(Base):
    __tablename__ = "study"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str | None] = mapped_column(Text)
    as_of: Mapped[date | None] = mapped_column(Date)

    patients: Mapped[list[Patient]] = relationship(back_populates="study")


class Staff(Base):
    __tablename__ = "staff"
    id: Mapped[int] = mapped_column(primary_key=True)
    hsa_id: Mapped[str] = mapped_column(String(40), unique=True, index=True)


class Facility(Base):
    __tablename__ = "facility"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    kind: Mapped[str | None] = mapped_column(String(40))


class StorageLocation(Base):
    __tablename__ = "storage_location"
    id: Mapped[int] = mapped_column(primary_key=True)
    label: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    freezer: Mapped[str | None] = mapped_column(String(60), index=True)
    box: Mapped[str | None] = mapped_column(String(60), index=True)
    position: Mapped[str | None] = mapped_column(String(20))


class Patient(Base):
    __tablename__ = "patient"
    id: Mapped[int] = mapped_column(primary_key=True)
    study_id: Mapped[int] = mapped_column(ForeignKey("study.id"))
    label: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    sex: Mapped[str | None] = mapped_column(String(10))
    age: Mapped[float | None] = mapped_column(Float)
    enrolled_on: Mapped[date | None] = mapped_column(Date)
    consent: Mapped[bool] = mapped_column(Boolean, default=False)
    enrolled_by_id: Mapped[int | None] = mapped_column(ForeignKey("staff.id"))

    study: Mapped[Study] = relationship(back_populates="patients")
    specimens: Mapped[list[Specimen]] = relationship(back_populates="patient")


class Specimen(Base):
    __tablename__ = "specimen"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patient.id"), index=True)
    record_id: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    label: Mapped[str] = mapped_column(String(40))
    sample_type: Mapped[str | None] = mapped_column(String(30), index=True)
    collected_on: Mapped[date | None] = mapped_column(Date)
    stage_reached: Mapped[str] = mapped_column(String(20), index=True)
    is_repeat: Mapped[bool] = mapped_column(Boolean, default=False)
    repeat_of_id: Mapped[int | None] = mapped_column(ForeignKey("specimen.id"))
    storage_id: Mapped[int | None] = mapped_column(ForeignKey("storage_location.id"))
    # days since the last recorded step; NULL means it is still moving
    stalled_days: Mapped[int | None] = mapped_column(Integer)

    patient: Mapped[Patient] = relationship(back_populates="specimens")
    aliquots: Mapped[list[Aliquot]] = relationship(back_populates="specimen")
    deviations: Mapped[list[Deviation]] = relationship(back_populates="specimen")
    activities: Mapped[list[Activity]] = relationship(back_populates="specimen")


class Aliquot(Base):
    __tablename__ = "aliquot"
    id: Mapped[int] = mapped_column(primary_key=True)
    specimen_id: Mapped[int] = mapped_column(ForeignKey("specimen.id"), index=True)
    label: Mapped[str] = mapped_column(String(60), index=True)
    molecule: Mapped[str] = mapped_column(String(20), index=True)
    # peptide is made from protein by digestion, so it is a child of an aliquot,
    # not a sibling extracted alongside it
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("aliquot.id"))
    elution_ul: Mapped[float | None] = mapped_column(Float)
    buffer: Mapped[str | None] = mapped_column(String(60))
    concentration: Mapped[float | None] = mapped_column(Float)
    total: Mapped[float | None] = mapped_column(Float)
    qc_outcome: Mapped[str | None] = mapped_column(String(10), index=True)
    storage_id: Mapped[int | None] = mapped_column(ForeignKey("storage_location.id"), index=True)

    specimen: Mapped[Specimen] = relationship(back_populates="aliquots")
    runs: Mapped[list[PlatformRun]] = relationship(back_populates="aliquot")


class QCResult(Base):
    __tablename__ = "qc_result"
    id: Mapped[int] = mapped_column(primary_key=True)
    aliquot_id: Mapped[int] = mapped_column(ForeignKey("aliquot.id"), index=True)
    molecule: Mapped[str | None] = mapped_column(String(20))
    outcome: Mapped[str] = mapped_column(String(10), index=True)


class Deviation(Base):
    __tablename__ = "deviation"
    id: Mapped[int] = mapped_column(primary_key=True)
    specimen_id: Mapped[int] = mapped_column(ForeignKey("specimen.id"), index=True)
    deviation_type: Mapped[str] = mapped_column(String(30), index=True)
    note: Mapped[str | None] = mapped_column(Text)

    specimen: Mapped[Specimen] = relationship(back_populates="deviations")


class Activity(Base):
    __tablename__ = "activity"
    id: Mapped[int] = mapped_column(primary_key=True)
    specimen_id: Mapped[int | None] = mapped_column(ForeignKey("specimen.id"), index=True)
    kind: Mapped[str] = mapped_column(String(40), index=True)
    label: Mapped[str] = mapped_column(String(80))
    performed_on: Mapped[date | None] = mapped_column(Date)
    # The clock time the export recorded, as "HH:MM", where it recorded one.
    # Kept as text rather than a time column because it is a form field with no
    # timezone behind it, and because half of the steps have no time at all —
    # a nullable string says that plainly.
    performed_at: Mapped[str | None] = mapped_column(String(5))
    staff_id: Mapped[int | None] = mapped_column(ForeignKey("staff.id"), index=True)
    facility_id: Mapped[int | None] = mapped_column(ForeignKey("facility.id"))

    specimen: Mapped[Specimen] = relationship(back_populates="activities")


class PlatformRun(Base):
    __tablename__ = "platform_run"
    id: Mapped[int] = mapped_column(primary_key=True)
    aliquot_id: Mapped[int] = mapped_column(ForeignKey("aliquot.id"), index=True)
    facility_id: Mapped[int | None] = mapped_column(ForeignKey("facility.id"), index=True)
    molecule: Mapped[str | None] = mapped_column(String(20))
    sent_on: Mapped[date | None] = mapped_column(Date)
    returned_on: Mapped[date | None] = mapped_column(Date)
    volume_ul: Mapped[float | None] = mapped_column(Float)
    turnaround_days: Mapped[int | None] = mapped_column(Integer)

    aliquot: Mapped[Aliquot] = relationship(back_populates="runs")


class Identifier(Base):
    __tablename__ = "identifier"
    id: Mapped[int] = mapped_column(primary_key=True)
    system: Mapped[str] = mapped_column(String(60), index=True)
    value: Mapped[str] = mapped_column(String(80), index=True)
    owner_type: Mapped[str] = mapped_column(String(20), index=True)
    owner_id: Mapped[int] = mapped_column(Integer, index=True)


class Edge(Base):
    """The traversal side of the store.

    Denormalised on purpose: the graph view asks "what touches this", and one
    indexed table answers it without a join per relationship type.
    """
    __tablename__ = "edge"
    id: Mapped[int] = mapped_column(primary_key=True)
    src_type: Mapped[str] = mapped_column(String(20), index=True)
    src_id: Mapped[int] = mapped_column(Integer, index=True)
    dst_type: Mapped[str] = mapped_column(String(20), index=True)
    dst_id: Mapped[int] = mapped_column(Integer, index=True)
    type: Mapped[str] = mapped_column(String(30), index=True)


Index("ix_edge_src", Edge.src_type, Edge.src_id)
Index("ix_edge_dst", Edge.dst_type, Edge.dst_id)
